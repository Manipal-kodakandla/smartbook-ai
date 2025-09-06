import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.56.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

// 🧹 Clean extracted text (remove binary/unicode junk)
function cleanExtractedText(input: string): string {
  return input
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 🛡️ Strict JSON parse only
function safeParseTopics(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (typeof parsed === "object" && parsed !== null) return [parsed];
    return [];
  } catch (e) {
    console.error("❌ JSON parse failed:", e.message);
    console.error("Raw snippet:", raw.slice(0, 300));
    return [];
  }
}

// 🧹 Clean topic before DB insert
function cleanTopic(t: any, i: number, documentId: string) {
  const clean = (val: string) => (typeof val === "string" ? cleanExtractedText(val) : "");

  return {
    document_id: documentId,
    title: clean(t.title) || `Topic ${i + 1}`,
    content: clean(t.content),
    simplified_explanation: clean(t.simplified_explanation),
    real_world_example: clean(t.real_world_example),
    keywords: Array.isArray(t.keywords)
      ? t.keywords.map((k: any) => clean(String(k))).filter(Boolean)
      : ["general"],
    topic_order: i,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { documentId, extractedText, meta, instruction } = await req.json();

    if (!documentId || !extractedText) {
      return new Response(
        JSON.stringify({ error: "documentId and extractedText are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Gemini API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Clean + limit notes
    const cleaned = cleanExtractedText(extractedText);
    const notes = cleaned.slice(0, 80_000);

    const confidence = meta?.extractionConfidence ?? "unknown";
    let cautionNote = "";
    if (confidence === "low") {
      cautionNote = "\n⚠️ WARNING: Extracted text may be incomplete or messy. State 'uncertain' if unsure.";
    }

    // === Strict JSON prompt ===
    const systemPrompt = `
You are converting raw study notes into structured learning topics.

RULES:
- Use ONLY the text in NOTES.
- Do not invent facts.
- Ignore formatting/typos.
- Output STRICT JSON ONLY (no markdown, no extra text).
- Must be an array of 3–5 objects like:
[
  {
    "title": "...",
    "content": "...",
    "simplified_explanation": "...",
    "real_world_example": "...",
    "keywords": ["...", "..."]
  }
]
- No code blocks, no commentary, only JSON.
- If you cannot generate, return [].

NOTES:
${notes}

Meta:
- Extraction method: ${meta?.extractionMethod ?? "unknown"}
- Confidence: ${confidence}

${instruction ?? ""}${cautionNote}
`.trim();

    // === Gemini call ===
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: systemPrompt }] }],
          generationConfig: { response_mime_type: "application/json" },
        }),
      }
    );

    if (!resp.ok) throw new Error(`Gemini API error ${resp.status}: ${await resp.text()}`);

    const data = await resp.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";

    const topics = safeParseTopics(raw);
    if (topics.length === 0) throw new Error("No valid topics returned from Gemini");

    const rows = topics.map((t, i) => cleanTopic(t, i, documentId));

    const { data: stored, error: insertErr } = await supabase.from("topics").insert(rows).select();
    if (insertErr) throw new Error(`Insert topics failed: ${insertErr.message}`);

    // Quizzes
    for (const topic of stored ?? []) {
      const qPrompt = `
Make ONE multiple-choice question strictly from this topic.

TITLE: ${topic.title}
CONTENT: ${topic.content}
SIMPLE: ${topic.simplified_explanation}

Return JSON ONLY:
{"question":"...","options":["A","B","C","D"],"correct_answer":0,"explanation":"..."}
`.trim();

      try {
        const qResp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: qPrompt }] }],
              generationConfig: { response_mime_type: "application/json" },
            }),
          }
        );

        if (!qResp.ok) {
          console.error("Quiz gen error:", await qResp.text());
          continue;
        }

        const qData = await qResp.json();
        const qRaw = qData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";

        const quiz = safeParseTopics(qRaw)[0] ?? null;
        if (!quiz) continue;

        await supabase.from("quizzes").insert([
          {
            topic_id: topic.id,
            question: cleanExtractedText(quiz.question || "Question unavailable"),
            options: Array.isArray(quiz.options)
              ? quiz.options.map((o: string) => cleanExtractedText(o))
              : ["A", "B", "C", "D"],
            correct_answer: typeof quiz.correct_answer === "number" ? quiz.correct_answer : 0,
            explanation: cleanExtractedText(quiz.explanation || ""),
          },
        ]);
      } catch (e) {
        console.error("Quiz generation failed:", e);
      }
    }

    await supabase.from("documents")
      .update({ processing_status: "completed", processed_at: new Date().toISOString() })
      .eq("id", documentId);

    return new Response(
      JSON.stringify({ success: true, topics: rows, message: "Document processed" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("process-document error:", err);
    return new Response(
      JSON.stringify({ error: err?.message || String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
