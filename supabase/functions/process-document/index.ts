import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.56.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

// 🧹 Clean extracted text
function cleanExtractedText(input: string): string {
  if (!input || typeof input !== "string") return "";

  return input
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, " ")
    .replace(/[\u0000-\u001F\u007F-\u009F\u00AD\u0600-\u0604\u061C\u06DD\u070F]/g, " ")
    .replace(/[\u2028\u2029]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 10000);
}

// 🔧 Extract JSON from Gemini response with repair mode
function extractJsonFromResponse(rawResponse: string): any[] {
  if (!rawResponse) return [];

  // Try direct parse
  try {
    const parsed = JSON.parse(rawResponse);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {}

  // Try markdown code blocks
  const codeBlockMatch = rawResponse.match(
    /```(?:json)?\s*(\[[\s\S]*?\]|\{[\s\S]*?\})\s*```/
  );
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1]);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {}
  }

  // Try array slice
  const jsonArrayMatch = rawResponse.match(/\[[\s\S]*\]/);
  if (jsonArrayMatch) {
    try {
      const parsed = JSON.parse(jsonArrayMatch[0]);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {}
  }

  // Try object slice
  const jsonObjectMatch = rawResponse.match(/\{[\s\S]*\}/);
  if (jsonObjectMatch) {
    try {
      const parsed = JSON.parse(jsonObjectMatch[0]);
      return [parsed];
    } catch {}
  }

  // Repair mode
  function tryRepairJson(raw: string): any[] {
    let candidate = raw.trim();

    // Balance brackets
    const opens = (candidate.match(/\[/g) || []).length;
    const closes = (candidate.match(/\]/g) || []).length;
    if (opens > closes) candidate += "]".repeat(opens - closes);

    const objOpens = (candidate.match(/{/g) || []).length;
    const objCloses = (candidate.match(/}/g) || []).length;
    if (objOpens > objCloses) candidate += "}".repeat(objOpens - objCloses);

    try {
      const parsed = JSON.parse(candidate);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }
  }

  const repaired = tryRepairJson(rawResponse);
  if (repaired.length > 0) {
    console.warn("⚠️ Used repair mode to fix JSON");
    return repaired;
  }

  console.error("❌ Could not extract valid JSON from response");
  console.error("Raw response (first 500 chars):", rawResponse.slice(0, 500));
  return [];
}

// 🧹 Validate and clean topic object
function validateAndCleanTopic(topic: any, index: number, documentId: string) {
  if (!topic || typeof topic !== "object") return null;

  const cleanField = (val: any, fallback = "") =>
    typeof val === "string" ? cleanExtractedText(val) || fallback : fallback;

  const cleanKeywords = (keywords: any) => {
    if (Array.isArray(keywords)) {
      const cleaned = keywords
        .map((k) => cleanField(String(k)))
        .filter((k) => k.length > 0 && k.length < 50);
      return cleaned.length > 0 ? cleaned.slice(0, 6) : ["general"];
    }
    return ["general"];
  };

  return {
    document_id: documentId,
    title: cleanField(topic.title, `Topic ${index + 1}`).slice(0, 100),
    content: cleanField(topic.content, "Content not available").slice(0, 2000),
    simplified_explanation: cleanField(topic.simplified_explanation, "").slice(0, 1000),
    real_world_example: cleanField(topic.real_world_example, "").slice(0, 1000),
    keywords: cleanKeywords(topic.keywords),
    topic_order: index,
  };
}

// 🎯 Generate topics with retry
async function generateTopicsWithRetry(notes: string, meta: any, instruction?: string, maxRetries = 3) {
  const confidence = meta?.extractionConfidence ?? "unknown";
  let cautionNote = confidence === "low"
    ? "\n⚠️ WARNING: Text quality is low. Use 'Content unclear from source' if unsure."
    : "";

  const basePrompt = `
You are an AI that converts study notes into structured topics.

RULES:
1. Output ONLY valid JSON (no markdown, no text outside JSON)
2. Return 2–4 topic objects
3. Use ONLY the provided NOTES
4. Each object must have: title, content, simplified_explanation, real_world_example, keywords
5. If unclear, write "Content unclear from source"
6. Keep titles under 80 characters
7. Keywords must be an array of 3–5 strings

NOTES:
${notes}

Meta: ${meta?.extractionMethod ?? "unknown"} extraction, confidence: ${confidence}
${instruction || ""}${cautionNote}
`.trim();

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: basePrompt }] }],
            generationConfig: {
              response_mime_type: "application/json",
              temperature: 0.3,
              maxOutputTokens: 2048,
            },
          }),
        }
      );

      if (!response.ok) {
        const errText = await response.text();
        console.error(`Gemini error ${response.status}:`, errText);
        if (attempt === maxRetries) throw new Error(`Gemini failed after ${maxRetries} attempts`);
        continue;
      }

      const data = await response.json();
      const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!raw) throw new Error("Empty Gemini response");

      const topics = extractJsonFromResponse(raw);
      if (topics.length > 0) return topics;

      if (attempt === maxRetries) throw new Error("Failed to parse topics from Gemini");
    } catch (err) {
      console.error(`Attempt ${attempt} failed:`, err.message);
      if (attempt === maxRetries) throw err;
      await new Promise((res) => setTimeout(res, 1000 * attempt));
    }
  }

  return [];
}

// 🎯 Quiz generator
async function generateQuizForTopic(topic: any) {
  try {
    const prompt = `Make one multiple-choice question. Return ONLY valid JSON.

TOPIC: ${topic.title}
CONTENT: ${topic.content}

Format:
{"question":"...","options":["A","B","C","D"],"correct_answer":0,"explanation":"..."}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { response_mime_type: "application/json" },
        }),
      }
    );

    if (!response.ok) {
      console.error("Quiz generation error:", await response.text());
      return null;
    }

    const data = await response.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) return null;

    const parsed = extractJsonFromResponse(raw)[0];
    if (!parsed) return null;

    return {
      topic_id: topic.id,
      question: cleanExtractedText(parsed.question || "Question unavailable"),
      options: Array.isArray(parsed.options)
        ? parsed.options.slice(0, 4).map((o: string) => cleanExtractedText(o))
        : ["A", "B", "C", "D"],
      correct_answer: typeof parsed.correct_answer === "number" ? parsed.correct_answer : 0,
      explanation: cleanExtractedText(parsed.explanation || ""),
    };
  } catch (err) {
    console.error("Quiz generation failed:", err);
    return null;
  }
}

// 🚀 Main handler
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { documentId, extractedText, meta, instruction } = await req.json();

    if (!documentId || !extractedText) {
      return new Response(JSON.stringify({ error: "documentId and extractedText are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mark processing
    await supabase.from("documents").update({ processing_status: "processing" }).eq("id", documentId);

    // Generate topics
    const notes = cleanExtractedText(extractedText);
    const rawTopics = await generateTopicsWithRetry(notes, meta, instruction);
    if (rawTopics.length === 0) throw new Error("No valid topics generated");

    const topics = rawTopics
      .map((t, i) => validateAndCleanTopic(t, i, documentId))
      .filter(Boolean);

    const { data: stored, error: insertErr } = await supabase.from("topics").insert(topics).select();
    if (insertErr) throw new Error(`Insert topics failed: ${insertErr.message}`);

    // Generate quizzes
    let quizzesCreated = 0;
    for (const topic of stored ?? []) {
      const quiz = await generateQuizForTopic(topic);
      if (quiz) {
        const { error: qErr } = await supabase.from("quizzes").insert([quiz]);
        if (!qErr) quizzesCreated++;
      }
    }

    // Mark complete
    await supabase
      .from("documents")
      .update({ processing_status: "completed", processed_at: new Date().toISOString() })
      .eq("id", documentId);

    return new Response(
      JSON.stringify({ success: true, topics, quizzesCreated, message: "Document processed" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("❌ process-document error:", err);

    return new Response(JSON.stringify({ error: err?.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
