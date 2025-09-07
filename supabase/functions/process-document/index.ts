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
    .slice(0, 15000); // Increased limit for better context
}

// 🚫 Detect gibberish-like text
function looksLikeGibberish(text: string): boolean {
  if (!text) return true;
  const letters = text.match(/[a-zA-Z]/g) || [];
  const words = text.split(/\s+/).filter(w => w.length > 2);
  return letters.length < 20 || words.length < 5;
}

// 🎯 Enhanced JSON extraction with multiple strategies
function extractJsonFromResponse(rawResponse: string): any[] {
  if (!rawResponse) return [];
  
  console.log("🔍 Raw response preview:", rawResponse.slice(0, 200));

  const tryParse = (str: string) => {
    try {
      const parsed = JSON.parse(str.trim());
      return parsed;
    } catch {
      return null;
    }
  };

  // Strategy 1: Direct JSON parse
  const direct = tryParse(rawResponse);
  if (direct) return Array.isArray(direct) ? direct : [direct];

  // Strategy 2: Find JSON in markdown code blocks
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  let match;
  while ((match = codeBlockRegex.exec(rawResponse)) !== null) {
    const parsed = tryParse(match[1]);
    if (parsed) return Array.isArray(parsed) ? parsed : [parsed];
  }

  // Strategy 3: Extract JSON array pattern
  const arrayRegex = /\[\s*\{[\s\S]*?\}\s*\]/g;
  const arrayMatches = rawResponse.match(arrayRegex);
  if (arrayMatches) {
    for (const arrayMatch of arrayMatches) {
      const parsed = tryParse(arrayMatch);
      if (parsed && Array.isArray(parsed)) return parsed;
    }
  }

  // Strategy 4: Extract individual JSON objects and combine
  const objectRegex = /\{\s*"[^"]+"\s*:\s*"[^"]*"[\s\S]*?\}/g;
  const objects = [];
  let objMatch;
  while ((objMatch = objectRegex.exec(rawResponse)) !== null) {
    const parsed = tryParse(objMatch[0]);
    if (parsed && typeof parsed === 'object') {
      objects.push(parsed);
    }
  }
  if (objects.length > 0) return objects;

  // Strategy 5: Line-by-line reconstruction for malformed JSON
  const lines = rawResponse.split('\n').map(l => l.trim()).filter(l => l);
  const reconstructed = [];
  let currentObj = {};
  let inObject = false;

  for (const line of lines) {
    if (line.includes('"title"') && line.includes(':')) {
      if (inObject && Object.keys(currentObj).length > 0) {
        reconstructed.push({...currentObj});
      }
      currentObj = {};
      inObject = true;
      
      const titleMatch = line.match(/"title"\s*:\s*"([^"]+)"/);
      if (titleMatch) currentObj.title = titleMatch[1];
    } else if (inObject) {
      const fieldMatch = line.match(/"([^"]+)"\s*:\s*"([^"]+)"/);
      if (fieldMatch) {
        currentObj[fieldMatch[1]] = fieldMatch[2];
      }
      const arrayMatch = line.match(/"keywords"\s*:\s*\[(.*?)\]/);
      if (arrayMatch) {
        currentObj.keywords = arrayMatch[1].split(',').map(k => k.trim().replace(/"/g, ''));
      }
    }
  }
  if (inObject && Object.keys(currentObj).length > 0) {
    reconstructed.push(currentObj);
  }
  
  if (reconstructed.length > 0) {
    console.log("✅ Reconstructed from malformed JSON:", reconstructed.length, "objects");
    return reconstructed;
  }

  console.error("❌ All JSON parsing strategies failed");
  return [];
}

// ✅ Enhanced topic validation and cleaning
function validateAndCleanTopic(topic: any, index: number, documentId: string) {
  if (!topic || typeof topic !== "object") return null;

  const clean = (val: any) => {
    if (typeof val !== "string") return "";
    return cleanExtractedText(val).replace(/["""'']/g, '"');
  };

  // Skip completely empty or placeholder topics
  const badValues = [
    "content unclear", "unclear", "example of application", 
    "no content", "not available", "see document", "refer to text",
    "n/a", "tbd", "to be determined", "placeholder"
  ];
  
  const title = clean(topic.title || topic.Title || `Topic ${index + 1}`);
  const content = clean(topic.content || topic.Content || topic.description || "");
  
  if (badValues.some(bad => 
    title.toLowerCase().includes(bad) || 
    content.toLowerCase().includes(bad)
  )) {
    return null;
  }

  // Ensure minimum content quality
  if (title.length < 3 || content.length < 10) return null;

  // Process keywords
  let keywords = [];
  if (Array.isArray(topic.keywords)) {
    keywords = topic.keywords.map(k => clean(k)).filter(k => k.length > 0);
  } else if (typeof topic.keywords === "string") {
    keywords = topic.keywords.split(',').map(k => clean(k)).filter(k => k.length > 0);
  }
  
  // Generate keywords from content if none provided
  if (keywords.length === 0) {
    const words = content.toLowerCase().split(/\s+/)
      .filter(w => w.length > 3 && !/^(the|and|for|with|this|that|from)$/.test(w))
      .slice(0, 3);
    keywords = words.length > 0 ? words : ["general"];
  }

  return {
    document_id: documentId,
    title: title.slice(0, 80),
    content: content.slice(0, 2000) || "Key concepts from the document content.",
    simplified_explanation: clean(topic.simplified_explanation || topic.explanation || `Simplified explanation of ${title.toLowerCase()}.`).slice(0, 1000),
    real_world_example: clean(topic.real_world_example || topic.example || `Practical application of ${title.toLowerCase()}.`).slice(0, 1000),
    keywords: keywords.slice(0, 5),
    topic_order: index,
  };
}

// 🤖 Enhanced Gemini prompt with explicit JSON structure
async function generateTopicsWithRetry(
  notes: string,
  meta: any,
  instruction?: string,
  maxRetries = 2
) {
  const enhancedPrompt = `Extract educational topics from this content. Return ONLY a valid JSON array with NO additional text or explanations.

REQUIRED JSON STRUCTURE:
[
  {
    "title": "Short Topic Title",
    "content": "Main concepts and details from the text",
    "simplified_explanation": "Easy-to-understand explanation", 
    "real_world_example": "Practical application or example",
    "keywords": ["keyword1", "keyword2", "keyword3"]
  }
]

STRICT RULES:
- Return 3-6 topics minimum
- Each topic must have ALL 5 fields
- NO placeholders like "unclear" or "not available"
- If content is messy, infer reasonable topics
- Keep titles under 80 characters
- Make content informative and educational
- Provide 3-5 relevant keywords per topic

CONTENT TO ANALYZE:
${notes.slice(0, 8000)}

${instruction || "Focus on creating practical, educational topics that students can learn from."}

Return JSON only:`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🤖 Gemini attempt ${attempt}/${maxRetries}...`);
      
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: enhancedPrompt }] }],
            generationConfig: {
              temperature: 0.3,
              topK: 20,
              topP: 0.8,
              maxOutputTokens: 3000,
              stopSequences: ["```"],
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Gemini API error (${response.status}):`, errorText.slice(0, 300));
        continue;
      }

      const data = await response.json();
      const rawContent = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      
      if (!rawContent) {
        console.error("❌ Empty response from Gemini");
        continue;
      }

      console.log("📥 Gemini raw response length:", rawContent.length);
      
      const topics = extractJsonFromResponse(rawContent);
      if (topics.length > 0) {
        console.log(`✅ Extracted ${topics.length} topics from Gemini`);
        return topics;
      } else {
        console.warn("⚠️ No valid topics extracted, trying next attempt...");
      }
    } catch (err) {
      console.error(`❌ Attempt ${attempt} failed:`, err.message);
    }
    
    // Exponential backoff
    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, attempt * 1500));
    }
  }
  
  console.warn("⚠️ All Gemini attempts failed");
  return [];
}

// 🛡️ Smart fallback topic generator
function createFallbackTopics(text: string, documentId: string): any[] {
  console.log("🛡️ Creating fallback topics from text analysis...");
  
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
  const words = text.toLowerCase().split(/\s+/);
  const wordFreq = {};
  
  // Count word frequency for keywords
  words.forEach(word => {
    const cleaned = word.replace(/[^\w]/g, '');
    if (cleaned.length > 3) {
      wordFreq[cleaned] = (wordFreq[cleaned] || 0) + 1;
    }
  });
  
  const topKeywords = Object.entries(wordFreq)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10)
    .map(([word]) => word);
  
  // Create topics from text chunks
  const topics = [];
  const chunkSize = Math.max(3, Math.floor(sentences.length / 4));
  
  for (let i = 0; i < Math.min(sentences.length, 12); i += chunkSize) {
    const chunk = sentences.slice(i, i + chunkSize).join('. ');
    if (chunk.length > 30) {
      const topicKeywords = topKeywords.slice(i % 3, (i % 3) + 3);
      
      topics.push({
        document_id: documentId,
        title: `Key Concept ${topics.length + 1}`,
        content: chunk.slice(0, 500),
        simplified_explanation: `This section covers important concepts related to ${topicKeywords.join(', ')}.`,
        real_world_example: `These concepts can be applied in practical scenarios involving ${topicKeywords[0] || 'the subject matter'}.`,
        keywords: topicKeywords.length > 0 ? topicKeywords : ['study', 'notes', 'concept'],
        topic_order: topics.length,
      });
    }
  }
  
  // Ensure minimum topics
  if (topics.length === 0) {
    topics.push({
      document_id: documentId,
      title: "Document Summary",
      content: text.slice(0, 800),
      simplified_explanation: "This document contains educational content for study and review.",
      real_world_example: "The concepts in this document can be applied in academic and professional contexts.",
      keywords: topKeywords.slice(0, 3).length > 0 ? topKeywords.slice(0, 3) : ['notes', 'study'],
      topic_order: 0,
    });
  }
  
  console.log(`✅ Created ${topics.length} fallback topics`);
  return topics.slice(0, 8); // Limit to 8 topics max
}

// 🚀 Main handler
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let documentId;
  try {
    console.log("📥 Processing document request...");
    const body = await req.json();
    ({ documentId } = body);
    const { extractedText, meta, instruction } = body;

    console.log(`📄 Document ID: ${documentId}`);
    console.log(`📊 Text length: ${extractedText?.length || 0} chars`);

    if (!documentId) {
      throw new Error("documentId is required");
    }

    if (!extractedText || looksLikeGibberish(extractedText)) {
      throw new Error("Text appears to be invalid or too short");
    }

    // Update status to processing
    await supabase
      .from("documents")
      .update({ processing_status: "processing" })
      .eq("id", documentId);

    const cleanedText = cleanExtractedText(extractedText);
    if (cleanedText.length < 10) {
      throw new Error("Insufficient text content after cleaning");
    }

    // Try Gemini first
    console.log("🤖 Attempting Gemini AI processing...");
    const rawTopics = await generateTopicsWithRetry(cleanedText, meta, instruction);

    // Validate and clean topics
    let validTopics = rawTopics
      .map((topic, index) => validateAndCleanTopic(topic, index, documentId))
      .filter(topic => topic !== null);

    // Fallback if Gemini fails or produces insufficient topics
    if (validTopics.length < 2) {
      console.log("🛡️ Using fallback topic generation...");
      const fallbackTopics = createFallbackTopics(cleanedText, documentId);
      
      // Merge any valid Gemini topics with fallback
      const combined = [...validTopics, ...fallbackTopics];
      validTopics = combined
        .map((topic, index) => ({ ...topic, topic_order: index }))
        .slice(0, 6); // Limit total topics
    }

    if (validTopics.length === 0) {
      throw new Error("Failed to generate any valid topics");
    }

    // Insert topics into database
    console.log(`💾 Inserting ${validTopics.length} topics into database...`);
    const { error: insertError } = await supabase
      .from("topics")
      .insert(validTopics);

    if (insertError) {
      throw new Error(`Database insertion failed: ${insertError.message}`);
    }

    // Update document status to completed
    await supabase
      .from("documents")
      .update({
        processing_status: "completed",
        processed_at: new Date().toISOString(),
      })
      .eq("id", documentId);

    console.log(`✅ Successfully processed document with ${validTopics.length} topics`);

    return new Response(
      JSON.stringify({
        success: true,
        topics: validTopics,
        message: `Successfully processed document with ${validTopics.length} topics`,
        source: rawTopics.length > 0 ? "gemini" : "fallback"
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );

  } catch (error) {
    console.error("❌ Processing failed:", error.message);

    // Update document status to failed
    if (documentId) {
      try {
        await supabase
          .from("documents")
          .update({
            processing_status: "failed",
            processed_at: new Date().toISOString(),
          })
          .eq("id", documentId);
      } catch (updateError) {
        console.error("Failed to update document status:", updateError);
      }
    }

    return new Response(
      JSON.stringify({ 
        error: error.message, 
        success: false 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
