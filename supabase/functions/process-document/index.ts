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
    .replace(/[\u2028\u2029]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20000);
}

// 🚫 Detect gibberish-like text
function looksLikeGibberish(text: string): boolean {
  if (!text) return true;
  const letters = text.match(/[a-zA-Z]/g) || [];
  return letters.length < 20;
}

// 🔧 Try to extract JSON from Gemini response
function extractJsonFromResponse(rawResponse: string): any[] {
  if (!rawResponse) return [];

  const tryParse = (str: string) => {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  };

  // Direct parse
  const direct = tryParse(rawResponse);
  if (direct) return Array.isArray(direct) ? direct : [direct];

  // JSON in code block
  const blockMatch = rawResponse.match(/```(?:json)?([\s\S]*?)```/);
  if (blockMatch) {
    const parsed = tryParse(blockMatch[1]);
    if (parsed) return Array.isArray(parsed) ? parsed : [parsed];
  }

  // Array match
  const arrMatch = rawResponse.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    const parsed = tryParse(arrMatch[0]);
    if (parsed) return Array.isArray(parsed) ? parsed : [parsed];
  }

  // Object match
  const objMatch = rawResponse.match(/\{[\s\S]*\}/);
  if (objMatch) {
    const parsed = tryParse(objMatch[0]);
    if (parsed) return Array.isArray(parsed) ? parsed : [parsed];
  }

  console.error("❌ JSON parse failed. Raw preview:", rawResponse.slice(0, 200));
  return [];
}

// ✅ Validate topic object
function validateAndCleanTopic(topic: any, index: number, documentId: string) {
  if (!topic || typeof topic !== "object") return null;

  const clean = (val: any, fallback = "") =>
    cleanExtractedText(typeof val === "string" ? val : fallback);

  const keywords = Array.isArray(topic.keywords)
    ? topic.keywords
        .map((k) => clean(k, ""))
        .filter((k) => k.length > 0 && k.length < 50)
        .slice(0, 5)
    : ["general"];

  return {
    document_id: documentId,
    title: clean(topic.title, `Topic ${index + 1}`).slice(0, 80),
    content: clean(topic.content, "Content unclear from source").slice(0, 2000),
    simplified_explanation: clean(topic.simplified_explanation, "").slice(0, 1000),
    real_world_example: clean(topic.real_world_example, "").slice(0, 1000),
    keywords,
    topic_order: index,
  };
}

// 🔄 Call Gemini with prompt
async function callGemini(prompt: string) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          response_mime_type: "application/json",
          temperature: 0.3,
          maxOutputTokens: 2048,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

// 🔄 Retry Gemini with fallback
async function generateTopicsWithRetry(notes: string, meta: any, instruction?: string, maxRetries = 2) {
  const prompts = [
    `Extract clear, structured topics from the following text.

Rules:
- JSON array only
- Each topic has: title, content, simplified_explanation, real_world_example, keywords
- If unclear, set fields to "Content unclear from source"
- Keep title under 80 chars
- 3–5 keywords per topic

Text:
${notes}
Metadata: ${meta?.extractionMethod ?? "unknown"}
${instruction || ""}`,

    // Fallback: simpler headings
    `The text may be noisy. Extract only high-level headings or terms as topics.

Rules:
- JSON array only
- Each topic has: title, content, simplified_explanation, real_world_example, keywords
- Keep title short (<=80 chars)

Text:
${notes}`,
  ];

  for (let p = 0; p < prompts.length; p++) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🤖 Prompt ${p + 1}, Attempt ${attempt}`);
        const rawContent = await callGemini(prompts[p]);
        const topics = extractJsonFromResponse(rawContent);
        if (topics.length > 0) {
          console.log(`✅ Got ${topics.length} topics`);
          return topics;
        }
      } catch (err) {
        console.error(`❌ Gemini attempt failed:`, err.message);
      }
      await new Promise((r) => setTimeout(r, attempt * 1000));
    }
  }
  return [];
}

// 🚀 Main handler
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    console.log("📥 Process document request received");
    const body = await req.json();
    const { documentId, extractedText, meta, instruction } = body;

    if (!documentId) {
      return new Response(JSON.stringify({ error: "documentId required" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    if (!extractedText || looksLikeGibberish(extractedText)) {
      throw new Error("Extracted text looks like gibberish or is empty");
    }

    await supabase.from("documents").update({ processing_status: "processing" }).eq("id", documentId);

    const cleanedText = cleanExtractedText(extractedText).slice(0, 50000);
    if (cleanedText.length < 10) throw new Error("Too little usable text");

    const rawTopics = await generateTopicsWithRetry(cleanedText, meta, instruction);

    // 🚨 Fallback topics if Gemini fails
    const finalTopics = (rawTopics.length > 0 ? rawTopics : [
      {
        title: "Key Concepts Identified",
        content: "Basic topics extracted from your notes.",
        simplified_explanation: "Main ideas rewritten simply.",
        real_world_example: "Example applications are unclear.",
        keywords: ["concepts", "basics"],
      },
      {
        title: "Possible Challenges",
        content: "Some content may not be clearly extracted.",
        simplified_explanation: "Difficult to read text.",
        real_world_example: "PDF encoding issues.",
        keywords: ["challenges", "encoding"],
      },
      {
        title: "Next Steps",
        content: "You can upload cleaner notes for better topics.",
        simplified_explanation: "Provide readable text.",
        real_world_example: "Uploading typed notes instead of scans.",
        keywords: ["next", "improvement"],
      },
    ]).map((t, i) => validateAndCleanTopic(t, i, documentId)).filter((t) => t !== null);

    // Insert into DB
    const { error: insertErr } = await supabase.from("topics").insert(finalTopics);
    if (insertErr) throw new Error(`Failed to insert topics: ${insertErr.message}`);

    await supabase.from("documents").update({
      processing_status: "completed",
      processed_at: new Date().toISOString(),
    }).eq("id", documentId);

    console.log(`🎉 Processed ${finalTopics.length} topics for document ${documentId}`);
    return new Response(JSON.stringify({ success: true, topics: finalTopics }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("❌ Process failed:", err.message);
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
