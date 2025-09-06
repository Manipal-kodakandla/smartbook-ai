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

// 🧹 Aggressively clean extracted text
function cleanExtractedText(input: string): string {
  if (!input || typeof input !== 'string') return '';
  
  return input
    // Remove control characters except tab, newline, carriage return
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, ' ')
    // Remove non-printable Unicode characters
    .replace(/[\u0000-\u001F\u007F-\u009F\u00AD\u0600-\u0604\u061C\u06DD\u070F]/g, ' ')
    // Remove problematic characters that break JSON
    .replace(/[\u2028\u2029]/g, ' ')
    // Replace multiple whitespace with single space
    .replace(/\s+/g, ' ')
    // Remove leading/trailing whitespace
    .trim()
    // Limit length
    .slice(0, 10000);
}

// 🛡️ Ultra-robust JSON cleaning
function sanitizeForJson(text: string): string {
  if (!text) return '';
  
  return text
    // Remove null bytes and other problematic characters
    .replace(/\0/g, '')
    // Fix common escape sequence issues
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    // Remove any remaining control characters
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .trim();
}

// 🔧 Extract JSON from Gemini response with multiple fallbacks
function extractJsonFromResponse(rawResponse: string): any[] {
  if (!rawResponse) return [];

  // Method 1: Direct parse
  try {
    const parsed = JSON.parse(rawResponse);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {}

  // Method 2: Extract JSON from markdown code blocks
  const codeBlockMatch = rawResponse.match(/```(?:json)?\s*(\[[\s\S]*?\]|\{[\s\S]*?\})\s*```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1]);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {}
  }

  // Method 3: Find JSON array or object patterns
  const jsonArrayMatch = rawResponse.match(/\[[\s\S]*\]/);
  if (jsonArrayMatch) {
    try {
      const parsed = JSON.parse(jsonArrayMatch[0]);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {}
  }

  const jsonObjectMatch = rawResponse.match(/\{[\s\S]*\}/);
  if (jsonObjectMatch) {
    try {
      const parsed = JSON.parse(jsonObjectMatch[0]);
      return [parsed];
    } catch {}
  }

  console.error("❌ Could not extract valid JSON from response");
  console.error("Raw response (first 500 chars):", rawResponse.slice(0, 500));
  return [];
}

// 🧹 Validate and clean topic object
function validateAndCleanTopic(topic: any, index: number, documentId: string) {
  if (!topic || typeof topic !== 'object') {
    return null;
  }

  const cleanField = (value: any, fallback = ''): string => {
    if (typeof value !== 'string') return fallback;
    return cleanExtractedText(value) || fallback;
  };

  const cleanKeywords = (keywords: any): string[] => {
    if (Array.isArray(keywords)) {
      const cleaned = keywords
        .map(k => cleanField(String(k)))
        .filter(k => k.length > 0 && k.length < 50);
      return cleaned.length > 0 ? cleaned.slice(0, 6) : ['general'];
    }
    return ['general'];
  };

  return {
    document_id: documentId,
    title: cleanField(topic.title, `Topic ${index + 1}`).slice(0, 100),
    content: cleanField(topic.content, 'Content not available').slice(0, 2000),
    simplified_explanation: cleanField(topic.simplified_explanation, '').slice(0, 1000),
    real_world_example: cleanField(topic.real_world_example, '').slice(0, 1000),
    keywords: cleanKeywords(topic.keywords),
    topic_order: index,
  };
}

rld_example, keywords
5. If content is unclear or garbled, use "Content unclear from source" for that field
6. Keep titles under 80 characters
7. Keywords should be 3-5 relevant terms as an array

NOTES TO PROCESS:
${notes}

Metadata: ${meta?.extractionMethod ?? "unknown"} extraction, confidence: ${confidence}
${instruction || ""}${cautionNote}

Return format (JSON array only):`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 Attempt ${attempt} to generate topics`);
      
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
              maxOutputTokens: 2048
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Gemini API error ${response.status}:`, errorText);
        if (attempt === maxRetries) {
          throw new Error(`Gemini API failed after ${maxRetries} attempts`);
        }
        continue;
      }

      const data = await response.json();
      const rawContent = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!rawContent) {
        console.error("No content in Gemini response");
        if (attempt === maxRetries) {
          throw new Error("No content returned from Gemini");
        }
        continue;
      }

      console.log("Raw Gemini response (first 200 chars):", rawContent.slice(0, 200));

      const topics = extractJsonFromResponse(rawContent);
      
      if (topics.length > 0) {
        console.log(`✅ Successfully parsed ${topics.length} topics on attempt ${attempt}`);
        return topics;
      }

      if (attempt === maxRetries) {
        throw new Error("Could not parse valid topics from Gemini response");
      }

    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error.message);
      if (attempt === maxRetries) {
        throw error;
      }
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }

  return [];
}

// 🎯 Generate quiz with fallback
async function generateQuizForTopic(topic: any): Promise<any | null> {
  try {
    const prompt = `Create a multiple choice question from this topic. Return ONLY valid JSON.

TOPIC: ${topic.title}
CONTENT: ${topic.content}
EXPLANATION: ${topic.simplified_explanation}

Return this exact JSON format:
{"question":"Your question here?","options":["Option A","Option B","Option C","Option D"],"correct_answer":0,"explanation":"Why this answer is correct"}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            response_mime_type: "application/json",
            temperature: 0.4,
            maxOutputTokens: 512
          },
        }),
      }
    );

    if (!response.ok) {
      console.error("Quiz generation failed:", await response.text());
      return null;
    }

    const data = await response.json();
    const rawContent = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!rawContent) return null;

    const quizzes = extractJsonFromResponse(rawContent);
    const quiz = quizzes[0];

    if (!quiz || !quiz.question) return null;

    return {
      topic_id: topic.id,
      question: cleanExtractedText(quiz.question || "Question not available").slice(0, 500),
      options: Array.isArray(quiz.options) 
        ? quiz.options.slice(0, 4).map((opt: any) => cleanExtractedText(String(opt) || "Option").slice(0, 200))
        : ["Option A", "Option B", "Option C", "Option D"],
      correct_answer: typeof quiz.correct_answer === 'number' && quiz.correct_answer >= 0 && quiz.correct_answer <= 3 
        ? quiz.correct_answer 
        : 0,
      explanation: cleanExtractedText(quiz.explanation || "No explanation available").slice(0, 500),
    };

  } catch (error) {
    console.error("Quiz generation error:", error);
    return null;
  }
}

// 🚀 Main handler
serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("📄 Processing document request...");

    const body = await req.json();
    const { documentId, extractedText, meta, instruction } = body;

    // Validate required fields
    if (!documentId) {
      return new Response(
        JSON.stringify({ error: "documentId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!extractedText || typeof extractedText !== 'string' || extractedText.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Valid extractedText is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Gemini API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update document status to processing
    await supabase
      .from("documents")
      .update({ processing_status: "processing" })
      .eq("id", documentId);

    // Clean and prepare text
    const cleanedText = cleanExtractedText(extractedText);
    const limitedText = cleanedText.slice(0, 50000); // Reasonable limit for Gemini

    if (limitedText.length < 10) {
      throw new Error("Extracted text is too short or contains no readable content");
    }

    console.log(`📝 Processing ${limitedText.length} characters of cleaned text`);

    // Generate topics with retry logic
    const rawTopics = await generateTopicsWithRetry(limitedText, meta, instruction);
    
    if (rawTopics.length === 0) {
      throw new Error("Failed to generate any valid topics from the document");
    }

    // Validate and clean topics
    const validTopics = rawTopics
      .map((topic, index) => validateAndCleanTopic(topic, index, documentId))
      .filter(topic => topic !== null);

    if (validTopics.length === 0) {
      throw new Error("No valid topics could be created from the generated content");
    }

    console.log(`✅ Created ${validTopics.length} valid topics`);

    // Insert topics into database
    const { data: insertedTopics, error: insertError } = await supabase
      .from("topics")
      .insert(validTopics)
      .select();

    if (insertError) {
      console.error("Database insert error:", insertError);
      throw new Error(`Failed to save topics: ${insertError.message}`);
    }

    console.log(`💾 Saved ${insertedTopics?.length || 0} topics to database`);

    // Generate quizzes for each topic
    let quizzesCreated = 0;
    if (insertedTopics) {
      for (const topic of insertedTopics) {
        try {
          const quiz = await generateQuizForTopic(topic);
          if (quiz) {
            const { error: quizError } = await supabase
              .from("quizzes")
              .insert([quiz]);
            
            if (!quizError) {
              quizzesCreated++;
            } else {
              console.error(`Quiz insert error for topic ${topic.id}:`, quizError);
            }
          }
        } catch (error) {
          console.error(`Quiz generation failed for topic ${topic.id}:`, error);
        }
      }
    }

    console.log(`🎯 Created ${quizzesCreated} quizzes`);

    // Mark document as completed
    await supabase
      .from("documents")
      .update({
        processing_status: "completed",
        processed_at: new Date().toISOString(),
      })
      .eq("id", documentId);

    console.log("✅ Document processing completed successfully");

    return new Response(
      JSON.stringify({
        success: true,
        topics: validTopics,
        quizzesCreated,
        message: `Successfully processed document with ${validTopics.length} topics and ${quizzesCreated} quizzes`,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("❌ Document processing failed:", error);

    // Try to update document status to failed
    try {
      const { documentId } = await req.json();
      if (documentId) {
        await supabase
          .from("documents")
          .update({
            processing_status: "failed",
            processed_at: new Date().toISOString(),
          })
          .eq("id", documentId);
      }
    } catch (statusUpdateError) {
      console.error("Failed to update document status:", statusUpdateError);
    }

    return new Response(
      JSON.stringify({
        error: error?.message || String(error),
        details: "Document processing failed. Please check the logs for more information.",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
