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
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, " ") // keep printable ASCII
    .replace(/\s+/g, " ") // collapse spaces
    .trim();
}

// 🛡️ Safe JSON parser (handles single objects, broken JSON)
function safeJsonParse(raw: string, fallback: any): any {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (typeof parsed === "object") return [parsed]; // wrap single object
    return fallback;
  } catch {
    console.error("⚠️ JSON parse failed. Raw:", raw);
    return fallback;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { documentId, extractedText, meta, instruction } = await req.json();

    if (!documentId || !extractedText) {
      return new Response(JSON.stringify({ error: "documentId and extractedText are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (!GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: "Gemini API key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 🧹 Clean + limit notes
    const cleaned = cleanExtractedText(extractedText);
    const notes = cleaned.slice(0, 80_000);

    // Confidence guardrails
    const confidence = meta?.extractionConfidence ?? "unknown";
    let cautionNote = "";
    if (confidence === "low") {
      cautionNote =
        "\n⚠️ WARNING: Extracted text may be incomplete or messy. Be cautious in summarizing. If unsure, state 'uncertain'.";
    }

    // === Prompt for Gemini ===
    const systemPrompt = `
You are converting raw study notes into structured learning topics.

RULES:
- Use ONLY the text in NOTES below.
- Do not invent facts outside NOTES.
- Ignore formatting/typos.
- If content looks incomplete, explicitly mention uncertainty.
- Output valid JSON (no markdown), array of 3–5 objects:
  [{ "title": "...", "content": "...", "simplified_explanation": "...", "real_world_example": "...", "keywords": ["..."] }]
- "title" <= 50 chars.
- "keywords" = 3–6 terms.

NOTES:
${notes}

Extra meta:
- Extraction method: ${meta?.extractionMethod ?? "unknown"}
- Confidence: ${confidence}

${instruction ?? ""}${cautionNote}
`.trim();

    // === Gemini API call ===
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: systemPrompt }] }],
          generationConfig: { response_mime_type: "application/json" }
        })
      }
    );

    if (!resp.ok) {
      throw new Error(`Gemini API error ${resp.status}: ${await resp.text()}`);
    }

    const data = await resp.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";

    // 🛡️ Parse topics safely
    const topics = safeJsonParse(raw, [
      {
        title: "Main Concepts",
        content: "Key concepts identified from your notes.",
        simplified_explanation: "The main ideas rewritten simply.",
        real_world_example: "Example of application.",
        keywords: ["concepts"]
      }
    ]);

    // Insert topics
    const rows = topics.map((t: any, i: number) => ({
      document_id: documentId,
      title: t.title || `Topic ${i + 1}`,
      content: t.content || "",
      simplified_explanation: t.simplified_explanation || "",
      real_world_example: t.real_world_example || "",
      keywords: Array.isArray(t.keywords) ? t.keywords : ["general"],
      topic_order: i
    }));

    const { data: stored, error: insertErr } = await supabase
      .from("topics")
      .insert(rows)
      .select();

    if (insertErr) throw new Error(`Insert topics failed: ${insertErr.message}`);

    // === Generate quizzes per topic ===
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
              generationConfig: { response_mime_type: "application/json" }
            })
          }
        );

        if (!qResp.ok) {
          console.error("Quiz gen error:", await qResp.text());
          continue;
        }

        const qData = await qResp.json();
        const qRaw = qData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";

        const quiz = safeJsonParse(qRaw, null);
        if (!quiz || !quiz.question) continue;

        await supabase.from("quizzes").insert([
          {
            topic_id: topic.id,
            question: quiz.question || "Question unavailable",
            options: Array.isArray(quiz.options) ? quiz.options : ["A", "B", "C", "D"],
            correct_answer: typeof quiz.correct_answer === "number" ? quiz.correct_answer : 0,
            explanation: quiz.explanation || ""
          }
        ]);
      } catch (e) {
        console.error("Quiz generation failed:", e);
      }
    }

    // Mark document completed
    await supabase
      .from("documents")
      .update({
        processing_status: "completed",
        processed_at: new Date().toISOString()
      })
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
