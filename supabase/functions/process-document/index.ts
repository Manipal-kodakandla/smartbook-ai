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
    .slice(0, 10000);
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

  // Method 1: direct parse
  const direct = tryParse(rawResponse);
  if (direct) return Array.isArray(direct) ? direct : [direct];

  // Method 2: JSON in code block
  const blockMatch = rawResponse.match(/```(?:json)?([\s\S]*?)```/);
  if (blockMatch) {
    const parsed = tryParse(blockMatch[1]);
    if (parsed) return Array.isArray(parsed) ? parsed : [parsed];
  }

  // Method 3: JSON array/object
  const arrMatch = rawResponse.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    const parsed = tryParse(arrMatch[0]);
    if (parsed) return Array.isArray(parsed) ? parsed : [parsed];
  }

  const objMatch = rawResponse.match(/\{[\s\S]*\}/);
  if (objMatch) {
    const parsed = tryParse(objMatch[0]);
    if (parsed) return Array.isArray(parsed) ? parsed : [parsed];
  }

  console.error("❌ JSON parse failed. Raw preview:", rawResponse.slice(0, 300));
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

// 🔄 Retry Gemini call
async function generateTopicsWithRetry(notes: string, meta: any, instruction?: string, maxRetries = 3) {
  const basePrompt = `Extract clear, structured topics from the following text.

Rules:
- JSON array only
- Each topic has: title, content, simplified_explanation, real_world_example, keywords
- If unclear, set fields to "Content unclear from source"
- Keep title under 80 chars
- 3–5 keywords per topic

Text:
${notes}

Metadata: ${meta?.extractionMethod ?? "unknown"}
${instruction || ""}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🤖 Attempt ${attempt}: Calling Gemini API...`);
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
        const errorText = await response.text();
        console.error(`❌ Gemini error (${response.status}):`, errorText);
        continue;
      }

      const data = await response.json();
      const rawContent = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      console.log("📥 Gemini response received, parsing...");

      const topics = extractJsonFromResponse(rawContent);
      if (topics.length > 0) {
        console.log(`✅ Successfully parsed ${topics.length} topics`);
        return topics;
      }
    } catch (err) {
      console.error(`❌ Retry ${attempt} failed:`, err.message);
    }
    await new Promise((r) => setTimeout(r, attempt * 1000));
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

    console.log(`📄 Processing document ID: ${documentId}`);
    console.log(`📊 Text length: ${extractedText?.length || 0} characters`);

    if (!documentId) {
      return new Response(JSON.stringify({ error: "documentId required" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    if (!extractedText || looksLikeGibberish(extractedText)) {
      console.error("❌ Text looks like gibberish or is empty");
      throw new Error("Extracted text looks like gibberish or is empty");
    }

    console.log("📝 Updating document status to processing...");
    await supabase.from("documents").update({ processing_status: "processing" }).eq("id", documentId);

    const cleanedText = cleanExtractedText(extractedText).slice(0, 50000);
    if (cleanedText.length < 10) throw new Error("Too little usable text");

    console.log(`🧹 Cleaned text length: ${cleanedText.length} characters`);

    const rawTopics = await generateTopicsWithRetry(cleanedText, meta, instruction);
    if (rawTopics.length === 0) throw new Error("No valid topics from Gemini");

    console.log("🔧 Validating and cleaning topics...");
    const validTopics = rawTopics
      .map((t, i) => validateAndCleanTopic(t, i, documentId))
      .filter((t) => t !== null);

    if (validTopics.length === 0) throw new Error("No valid topics after cleaning");

    console.log(`💾 Inserting ${validTopics.length} topics into database...`);
    const { data: inserted, error: insertErr } = await supabase
      .from("topics")
      .insert(validTopics)
      .select();

    if (insertErr) throw new Error(`Failed to insert topics: ${insertErr.message}`);

    console.log("✅ Updating document status to completed...");
    await supabase.from("documents").update({
      processing_status: "completed",
      processed_at: new Date().toISOString(),
    }).eq("id", documentId);

    console.log(`🎉 Successfully processed ${validTopics.length} topics for document ${documentId}`);

    return new Response(
      JSON.stringify({
        success: true,
        topics: validTopics,
        message: `✅ Processed with ${validTopics.length} topics`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("❌ Process failed:", err.message);
    
    // Try to update document status to failed if we have the documentId
    try {
      const body = await req.clone().json();
      if (body.documentId) {
        console.log("📝 Updating document status to failed...");
        await supabase.from("documents").update({
          processing_status: "failed",
          processed_at: new Date().toISOString(),
        }).eq("id", body.documentId);
      }
    } catch (e) {
      console.error("Failed to update document status:", e);
    }

    return new Response(
      JSON.stringify({ error: err.message || String(err) }),
      { status: 500, headers: corsHeaders }
    );
  }
});