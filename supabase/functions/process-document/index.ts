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

// ---------------------- Cleaning helpers ----------------------
function cleanExtractedText(input: string): string {
  if (!input || typeof input !== "string") return "";
  return input
    // normalize smart quotes to straight quotes
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    // remove unicode line separators that break JSON
    .replace(/[\u2028\u2029]/g, " ")
    // remove control characters except tab/newline/carriage return
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Remove byte-level junk and fix common escape issues in a candidate JSON string
function cleanCandidateForJson(candidate: string): string {
  if (!candidate || typeof candidate !== "string") return candidate;

  let s = candidate;

  // Normalize quotes & newlines
  s = s.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  s = s.replace(/[\u2028\u2029]/g, " ");
  s = s.replace(/\r\n?/g, "\n");

  // Remove binary/control chars that will break JSON.parse
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");

  // Remove \xNN hex escapes (not valid JSON) and other invalid escapes
  s = s.replace(/\\x[0-9A-Fa-f]{2}/g, "");          // remove \xNN
  // Remove backslashes that are not followed by a valid JSON escape char
  s = s.replace(/\\(?!["\\/bfnrtu])/g, "");         // drop stray backslash
  // Collapse multiple spaces
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

// ---------------------- Balanced JSON extractor ----------------------
function extractBalanced(raw: string, openChar: string, closeChar: string, startIdx: number) {
  let i = startIdx;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (; i < raw.length; i++) {
    const ch = raw[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (ch === openChar) {
        depth++;
      } else if (ch === closeChar) {
        depth--;
        if (depth === 0) {
          return raw.slice(startIdx, i + 1);
        }
      }
    }
  }

  return null;
}

// Try to find JSON-like candidates (arrays/objects) inside raw text using balanced parsing
function findJsonCandidates(raw: string) {
  const candidates: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "[" || ch === "{") {
      const candidate = extractBalanced(raw, ch, ch === "[" ? "]" : "}", i);
      if (candidate) {
        candidates.push(candidate);
        i += candidate.length - 1;
      }
    }
  }
  return candidates;
}

// Try a set of strategies to parse JSON from rawGeminiText
function extractJsonFromResponse(rawResponse: string): any[] {
  if (!rawResponse || typeof rawResponse !== "string") return [];

  // 1) Direct parse
  try {
    const parsed = JSON.parse(rawResponse);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) {
    // continue to attempts
  }

  // 2) Markdown JSON code block extraction
  const codeBlockMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch?.[1]) {
    const candidate = cleanCandidateForJson(codeBlockMatch[1]);
    try {
      const parsed = JSON.parse(candidate);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) {
      // fallthrough
    }
  }

  // 3) Balanced extraction: find JSON array/object substrings
  const candidates = findJsonCandidates(rawResponse);
  for (const cand of candidates) {
    const cleaned = cleanCandidateForJson(cand);
    try {
      const parsed = JSON.parse(cleaned);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) {
      // Try a secondary repair: merge concatenated arrays/objects
      let repaired = cleaned.replace(/\]\s*\[/g, ",").replace(/}\s*{/g, "},{");
      try {
        const parsed2 = JSON.parse(repaired);
        return Array.isArray(parsed2) ? parsed2 : [parsed2];
      } catch (e2) {
        // continue to next candidate
      }
    }
  }

  // 4) Last-ditch: find first bracketed block via regex and try parse (greedy)
  const arrayMatch = rawResponse.match(/\[[\s\S]*\]/);
  if (arrayMatch?.[0]) {
    const cleaned = cleanCandidateForJson(arrayMatch[0]);
    try {
      const parsed = JSON.parse(cleaned);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) {}
  }

  const objMatch = rawResponse.match(/\{[\s\S]*\}/);
  if (objMatch?.[0]) {
    const cleaned = cleanCandidateForJson(objMatch[0]);
    try {
      const parsed = JSON.parse(cleaned);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) {}
  }

  console.error("❌ Could not extract valid JSON from Gemini response. Raw snippet:", rawResponse.slice(0, 400));
  return [];
}

// ---------------------- Validation & DB helpers ----------------------
function validateAndCleanTopic(topic: any, index: number, documentId: string) {
  if (!topic || typeof topic !== "object") return null;

  const cleanField = (v: any, fallback = "") => {
    if (typeof v !== "string") return fallback;
    const cleaned = cleanExtractedText(v);
    return cleaned || fallback;
  };

  const cleanKeywords = (k: any) => {
    if (!Array.isArray(k)) return ["general"];
    const ks = k.map((x: any) => cleanField(String(x))).filter(Boolean).slice(0, 6);
    return ks.length ? ks : ["general"];
  };

  return {
    document_id: documentId,
    title: cleanField(topic.title, `Topic ${index + 1}`).slice(0, 120),
    content: cleanField(topic.content, "Content unclear from source").slice(0, 4000),
    simplified_explanation: cleanField(topic.simplified_explanation, "").slice(0, 2000),
    real_world_example: cleanField(topic.real_world_example, "").slice(0, 2000),
    keywords: cleanKeywords(topic.keywords),
    topic_order: index,
  };
}

// ---------------------- Gemini call + retry ----------------------
async function callGemini(prompt: string) {
  const resp = await fetch(
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
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${t}`);
  }
  return await resp.json();
}

async function generateTopicsWithRetry(notes: string, meta: any, instruction?: string, maxRetries = 3) {
  const confidence = meta?.extractionConfidence ?? "unknown";
  let cautionNote = "";
  if (confidence === "low") {
    cautionNote = "\n⚠️ WARNING: Extracted text may be incomplete or messy. If unsure, use 'Content unclear from source'.";
  }

  const basePrompt = `You are an AI that converts study notes into structured topics.

STRICT RULES:
1) Output ONLY valid JSON (array) - no markdown, no commentary.
2) Return an array of 2-5 topic objects.
3) Use ONLY information in NOTES below.
4) Each object must have: title, content, simplified_explanation, real_world_example, keywords (array).
5) If content is unclear, set content to "Content unclear from source".

NOTES:
${notes}

Metadata: ${meta?.extractionMethod ?? "unknown"} extraction, confidence: ${confidence}
${instruction ?? ""}${cautionNote}
`;

  let lastErr: any = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 Gemini attempt ${attempt}`);
      const data = await callGemini(basePrompt);
      const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!raw) {
        lastErr = new Error("Gemini returned no text content");
        continue;
      }
      console.log("Raw Gemini preview:", raw.slice(0, 200));
      const topics = extractJsonFromResponse(raw);
      if (topics && topics.length > 0) return topics;
      lastErr = new Error("Could not extract valid JSON topics from Gemini output");
    } catch (e) {
      console.error("Gemini call failed:", e?.message ?? e);
      lastErr = e;
      // exponential backoff
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastErr ?? new Error("Gemini failed to produce topics");
}

// ---------------------- Quiz generation ----------------------
async function generateQuizForTopic(topic: any) {
  try {
    const prompt = `Create one multiple-choice question from this topic. Return ONLY valid JSON.

TOPIC_TITLE: ${topic.title}
CONTENT: ${topic.content}
EXPLANATION: ${topic.simplified_explanation}

Return:
{"question":"...","options":["A","B","C","D"],"correct_answer":0,"explanation":"..."}
`;
    const data = await callGemini(prompt);
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) return null;
    const qlist = extractJsonFromResponse(raw);
    const q = qlist[0];
    if (!q || !q.question) return null;
    // Normalize quiz
    return {
      topic_id: topic.id,
      question: cleanExtractedText(q.question).slice(0, 500),
      options: Array.isArray(q.options) ? q.options.slice(0, 4).map((o: any) => cleanExtractedText(String(o)).slice(0, 200)) : ["A", "B", "C", "D"],
      correct_answer: typeof q.correct_answer === "number" && q.correct_answer >= 0 && q.correct_answer <= 3 ? q.correct_answer : 0,
      explanation: cleanExtractedText(q.explanation || "").slice(0, 400),
    };
  } catch (e) {
    console.error("Quiz generation error:", e?.message ?? e);
    return null;
  }
}

// ---------------------- Main handler ----------------------
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let body: any;
  try {
    body = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const { documentId, extractedText, meta, instruction } = body ?? {};

  try {
    if (!documentId) return new Response(JSON.stringify({ error: "documentId is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!extractedText || typeof extractedText !== "string" || extractedText.trim().length === 0) {
      return new Response(JSON.stringify({ error: "Valid extractedText is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!GEMINI_API_KEY) return new Response(JSON.stringify({ error: "Gemini API key not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // mark processing
    await supabase.from("documents").update({ processing_status: "processing" }).eq("id", documentId);

    const cleanedText = cleanExtractedText(extractedText).slice(0, 80_000);
    if (cleanedText.length < 10) throw new Error("Extracted text too short after cleaning");

    // Get topics from Gemini
    const rawTopics = await generateTopicsWithRetry(cleanedText, meta ?? {}, instruction ?? "", 3);

    if (!rawTopics || rawTopics.length === 0) throw new Error("No valid topics returned from Gemini");

    // Validate & clean topics then insert
    const validTopics = rawTopics.map((t: any, i: number) => validateAndCleanTopic(t, i, documentId)).filter(Boolean);

    if (validTopics.length === 0) throw new Error("No valid topics after validation");

    const { data: insertedTopics, error: insertError } = await supabase.from("topics").insert(validTopics).select();
    if (insertError) throw new Error(`DB insert topics failed: ${insertError.message}`);

    // Generate quizzes for inserted topics
    let quizzesCreated = 0;
    if (insertedTopics) {
      for (const t of insertedTopics) {
        try {
          const quiz = await generateQuizForTopic(t);
          if (quiz) {
            const { error: quizErr } = await supabase.from("quizzes").insert([quiz]);
            if (!quizErr) quizzesCreated++;
            else console.error("Quiz insert error:", quizErr);
          }
        } catch (e) {
          console.error("Quiz loop error:", e);
        }
      }
    }

    // mark completed
    await supabase.from("documents").update({ processing_status: "completed", processed_at: new Date().toISOString() }).eq("id", documentId);

    return new Response(JSON.stringify({ success: true, topics: validTopics, quizzesCreated, message: `Processed ${validTopics.length} topics` }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("❌ Document processing failed:", err?.message ?? err);

    // try update doc to failed
    try {
      if (documentId) {
        await supabase.from("documents").update({ processing_status: "failed", processed_at: new Date().toISOString() }).eq("id", documentId);
      }
    } catch (uErr) {
      console.error("Failed to mark document failed:", uErr);
    }

    return new Response(JSON.stringify({ error: err?.message || String(err), details: "See logs for raw Gemini output." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
