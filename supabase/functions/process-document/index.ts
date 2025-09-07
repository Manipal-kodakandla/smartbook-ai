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

// 🧹 Clean extracted text
function cleanExtractedText(input: string): string {
  if (!input || typeof input !== "string") return "";
  return input
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, " ")
    .replace(/[\u2028\u2029]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 10000);
}

// 🚫 Detect gibberish
function looksLikeGibberish(text: string): boolean {
  if (!text) return true;
  const letters = text.match(/[a-zA-Z]/g) || [];
  return letters.length < 20;
}

// 🔧 Extract JSON from Gemini
function extractJsonFromResponse(rawResponse: string): any[] {
  if (!rawResponse) return [];
  try {
    return JSON.parse(rawResponse);
  } catch {}
  const blockMatch = rawResponse.match(/```(?:json)?([\s\S]*?)```/);
  if (blockMatch) {
    try { return JSON.parse(blockMatch[1]); } catch {}
  }
  console.error("❌ JSON parse failed. Preview:", rawResponse.slice(0, 500));
  return [];
}

// ✅ Validate topic
function validateAndCleanTopic(topic: any, index: number, documentId: string) {
  if (!topic || typeof topic !== "object") return null;
  const clean = (val: any, fallback = "") =>
    cleanExtractedText(typeof val === "string" ? val : fallback);
  const keywords = Array.isArray(topic.keywords)
    ? topic.keywords.map((k) => clean(k, "")).filter((k) => k.length > 0 && k.length < 50).slice(0, 5)
    : ["general"];
  return {
    document_id: documentId,
    title: clean(topic.title, `Topic ${index + 1}`).slice(0, 80),
    content: clean(topic.content, "Content unclear").slice(0, 2000),
    simplified_explanation: clean(topic.simplified_explanation, "").slice(0, 1000),
    real_world_example: clean(topic.real_world_example, "").slice(0, 1000),
    keywords,
    topic_order: index,
  };
}

// 🔄 Gemini call with chunk fallback
async function generateTopics(notes: string, meta: any, instruction?: string) {
  const basePrompt = `Extract clear, structured topics from this text.

Rules:
- JSON array only
- At least 5 topics if possible
- Each topic has: title, content, simplified_explanation, real_world_example, keywords
- If unclear, set fields to "Content unclear from source"
- Keep title under 80 chars, 3–5 keywords`;

  async function callGemini(text: string) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${basePrompt}\n\nText:\n${text}\n\nMetadata:${meta?.extractionMethod}` }] }],
          generationConfig: { response_mime_type: "application/json", temperature: 0.3, maxOutputTokens: 2048 },
        }),
      }
    );
    if (!response.ok) {
      console.error("❌ Gemini error:", await response.text());
      return [];
    }
    const data = await response.json();
    const rawContent = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    console.log("📥 Gemini raw:", rawContent.slice(0, 500));
    return extractJsonFromResponse(rawContent);
  }

  // First try full text
  let topics = await callGemini(notes);
  if (topics.length > 0) return topics;

  // Fallback: chunking
  console.log("⚡ Falling back to chunked processing...");
  const chunks: string[] = [];
  for (let i = 0; i < notes.length; i += 3000) {
    chunks.push(notes.slice(i, i + 3000));
  }
  let allTopics: any[] = [];
  for (let chunk of chunks) {
    const t = await callGemini(chunk);
    allTopics = allTopics.concat(t);
  }
  return allTopics;
}

// 🚀 Handler
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { documentId, extractedText, meta, instruction } = body;
    console.log(`📄 Processing document ${documentId}, length=${extractedText?.length}`);

    if (!documentId || !extractedText || looksLikeGibberish(extractedText)) {
      throw new Error("Invalid or empty text");
    }

    await supabase.from("documents").update({ processing_status: "processing" }).eq("id", documentId);

    const cleanedText = cleanExtractedText(extractedText).slice(0, 50000);
    const rawTopics = await generateTopics(cleanedText, meta, instruction);
    if (rawTopics.length === 0) throw new Error("No valid topics from Gemini");

    const validTopics = rawTopics
      .map((t, i) => validateAndCleanTopic(t, i, documentId))
      .filter((t) => t !== null);

    if (validTopics.length === 0) throw new Error("No valid topics after cleaning");

    await supabase.from("topics").insert(validTopics);
    await supabase.from("documents").update({
      processing_status: "completed",
      processed_at: new Date().toISOString(),
    }).eq("id", documentId);

    return new Response(JSON.stringify({ success: true, topics: validTopics }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("❌ Process failed:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
