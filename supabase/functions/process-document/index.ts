import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.56.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { documentId, extractedText } = await req.json();

    if (!documentId || !extractedText) {
      return new Response(
        JSON.stringify({ error: "documentId and extractedText are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Gemini API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Guard against junk “PDF/placeholder” text
    if (
      extractedText.startsWith("[EMPTY_OR_IMAGE_PDF]") ||
      extractedText.startsWith("[UNSUPPORTED_DOC]")
    ) {
      return new Response(
        JSON.stringify({ error: "Document has no usable text for processing." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Keep prompt within safe bounds
    const notes = extractedText.slice(0, 80_000);

    const systemPrompt = `
You are converting raw study notes into learning topics.
RULES:
- Use ONLY the content in NOTES below.
- DO NOT mention PDFs, OCR, files, AI processing, etc.
- No extra knowledge beyond the notes.
- Output valid JSON (no markdown), exactly an array of 3–5 objects:
  [{ "title": "...", "content": "...", "simplified_explanation": "...", "real_world_example": "...", "keywords": ["..."] }]
- "title" <= 50 chars.
- "keywords" must be an array of 3–6 short terms from the notes.
NOTES:
${notes}
`.trim();

    // Ask Gemini for strict JSON
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: systemPrompt }] }],
          generationConfig: {
            response_mime_type: "application/json",
          },
        }),
      },
    );

    if (!resp.ok) {
      const t = await resp.text();
      console.error("Gemini topic error:", resp.status, t);
      throw new Error(`Gemini API error ${resp.status}`);
    }

    const data = await resp.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";

    let topics: any[] = [];
    try {
      topics = JSON.parse(raw);
      if (!Array.isArray(topics)) throw new Error("Not an array");
    } catch (e) {
      console.error("Topic JSON parse failed; raw:", raw);
      topics = [
        {
          title: "Main Concepts",
          content: "Key concepts identified from your notes.",
          simplified_explanation: "The main ideas rewritten simply.",
          real_world_example: "How this concept might show up practically.",
          keywords: ["overview", "concepts"],
        },
      ];
    }

    const rows = topics.map((t: any, i: number) => ({
      document_id: documentId,
      title: t.title || `Topic ${i + 1}`,
      content: t.content || "",
      simplified_explanation: t.simplified_explanation || "",
      real_world_example: t.real_world_example || "",
      keywords: Array.isArray(t.keywords) ? t.keywords : ["general"],
      topic_order: i,
    }));

    const { data: stored, error: insertErr } = await createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    )
      .from("topics")
      .insert(rows)
      .select();

    if (insertErr) {
      console.error("Insert topics error:", insertErr);
      throw new Error("Failed to store topics");
    }

    console.log("Topics stored:", stored?.length ?? 0);

    // Create one MCQ per topic
    for (const topic of stored ?? []) {
      const qPrompt = `
Create ONE multiple-choice question strictly from this topic:

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
              generationConfig: {
                response_mime_type: "application/json",
              },
            }),
          },
        );
        if (!qResp.ok) {
          console.error("Gemini quiz error for topic", topic.id, await qResp.text());
          continue;
        }
        const qData = await qResp.json();
        const qRaw = qData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
        let quiz: any;
        try {
          quiz = JSON.parse(qRaw);
        } catch {
          console.error("Quiz JSON parse failed; raw:", qRaw);
          continue;
        }
        await createClient(
          Deno.env.get("SUPABASE_URL") ?? "",
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        )
          .from("quizzes")
          .insert([
            {
              topic_id: topic.id,
              question: quiz.question || "Question not available",
              options: Array.isArray(quiz.options)
                ? quiz.options
                : ["Option A", "Option B", "Option C", "Option D"],
              correct_answer:
                typeof quiz.correct_answer === "number" ? quiz.correct_answer : 0,
              explanation: quiz.explanation || "",
            },
          ]);
        console.log("Quiz stored for topic:", topic.title);
      } catch (e) {
        console.error("Quiz generation failed for topic:", topic.id, e);
      }
    }

    await supabase
      .from("documents")
      .update({
        processing_status: "completed",
        processed_at: new Date().toISOString(),
      })
      .eq("id", documentId);

    return new Response(
      JSON.stringify({ success: true, topics: rows, message: "Document processed" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("process-document error:", error);
    return new Response(
      JSON.stringify({ error: error?.message ?? String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
