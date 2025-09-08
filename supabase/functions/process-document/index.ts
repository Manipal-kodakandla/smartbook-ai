import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.56.1";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
// Clean text for processing - more conservative approach
function cleanText(input) {
  if (!input || typeof input !== "string") return "";
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ") // Remove control characters but keep more
  .replace(/\s+/g, " ") // Normalize whitespace
  .trim().slice(0, 15000); // Limit length for API
}
// Much more lenient content check - focus on whether we can extract ANY meaningful topics
function hasMinimumContent(text) {
  if (!text || text.length < 30) return false;
  const words = text.split(/\s+/).filter((w)=>w.length > 0);
  // Very basic check - just need some words with letters
  const wordsWithLetters = words.filter((word)=>/[a-zA-Z]/.test(word));
  console.log(`📊 Content check: ${words.length} total words, ${wordsWithLetters.length} with letters`);
  // Much more lenient - just need 10 words with letters
  return wordsWithLetters.length >= 10;
}
// Extract JSON from Gemini response with multiple strategies
function extractJsonFromResponse(rawResponse) {
  if (!rawResponse) return [];
  console.log("🔍 Parsing Gemini response...");
  const tryParse = (str)=>{
    try {
      const parsed = JSON.parse(str.trim());
      return parsed;
    } catch  {
      return null;
    }
  };
  // Strategy 1: Direct JSON parse
  const direct = tryParse(rawResponse);
  if (direct && Array.isArray(direct)) return direct;
  if (direct && typeof direct === 'object') return [
    direct
  ];
  // Strategy 2: Find JSON in markdown code blocks
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  let match;
  while((match = codeBlockRegex.exec(rawResponse)) !== null){
    const parsed = tryParse(match[1]);
    if (parsed) {
      return Array.isArray(parsed) ? parsed : [
        parsed
      ];
    }
  }
  // Strategy 3: Extract JSON array pattern
  const arrayRegex = /\[\s*\{[\s\S]*?\}\s*\]/g;
  const arrayMatches = rawResponse.match(arrayRegex);
  if (arrayMatches) {
    for (const arrayMatch of arrayMatches){
      const parsed = tryParse(arrayMatch);
      if (parsed && Array.isArray(parsed)) return parsed;
    }
  }
  // Strategy 4: Extract individual JSON objects
  const objectRegex = /\{\s*"[^"]+"\s*:\s*"[^"]*"[\s\S]*?\}/g;
  const objects = [];
  let objMatch;
  while((objMatch = objectRegex.exec(rawResponse)) !== null){
    const parsed = tryParse(objMatch[0]);
    if (parsed && typeof parsed === 'object') {
      objects.push(parsed);
    }
  }
  if (objects.length > 0) return objects;
  console.warn("⚠️ All JSON parsing strategies failed");
  return [];
}
// Validate and clean a topic object
function validateTopic(topic, index, documentId) {
  if (!topic || typeof topic !== "object") return null;
  const clean = (val)=>{
    if (typeof val !== "string") return "";
    return val.trim().replace(/["""'']/g, '"').slice(0, 2000);
  };
  // Extract fields with various possible names
  const title = clean(topic.title || topic.Title || topic.heading || `Topic ${index + 1}`);
  const content = clean(topic.content || topic.Content || topic.description || topic.summary || "");
  const explanation = clean(topic.simplified_explanation || topic.explanation || topic.simple_explanation || "");
  const example = clean(topic.real_world_example || topic.example || topic.real_example || "");
  // Very basic validation - just need a title
  if (title.length < 2) return null;
  // Handle keywords
  let keywords = [];
  if (Array.isArray(topic.keywords)) {
    keywords = topic.keywords.map((k)=>clean(k)).filter((k)=>k.length > 0);
  } else if (typeof topic.keywords === "string") {
    keywords = topic.keywords.split(/[,;]/).map((k)=>clean(k)).filter((k)=>k.length > 0);
  }
  // Generate keywords from content if none provided
  if (keywords.length === 0) {
    const words = (content || title).toLowerCase().split(/\s+/).filter((w)=>w.length > 2 && !/^(the|and|for|with|this|that|from|have|been|will|they|them)$/.test(w)).slice(0, 5);
    keywords = words.length > 0 ? words : [
      "general"
    ];
  }
  return {
    document_id: documentId,
    title: title.slice(0, 80),
    content: content || "Key concepts from the document content.",
    simplified_explanation: explanation || `This topic covers important concepts related to ${title.toLowerCase()}.`,
    real_world_example: example || `Understanding ${title.toLowerCase()} can be applied in various practical situations.`,
    keywords: keywords.slice(0, 5),
    topic_order: index
  };
}
// Generate topics using Gemini API with improved prompt
async function generateTopicsWithGemini(text, documentId, maxRetries = 3) {
  if (!GEMINI_API_KEY) {
    console.error("❌ GEMINI_API_KEY not found");
    return [];
  }
  // Improved prompt that's more forgiving of text quality issues
  const prompt = `Extract educational topics from this document content. Even if the text has some formatting issues or unclear parts, focus on identifying any meaningful concepts that can be learned.

Return ONLY a valid JSON array with no additional text or explanations.

Each topic should have these fields:
- title: Short descriptive title (under 80 characters)
- content: Main concepts and details (be creative if text is unclear)
- simplified_explanation: Easy-to-understand explanation
- real_world_example: Practical application or example
- keywords: Array of 3-5 relevant keywords

Requirements:
- Extract 3-6 topics if possible
- If text quality is poor, infer reasonable topics from available content
- Make content educational and meaningful
- Return valid JSON array format only
- Be creative and helpful even with imperfect text

Document content:
${text.slice(0, 8000)}

Return JSON array:`;
  for(let attempt = 1; attempt <= maxRetries; attempt++){
    try {
      console.log(`🤖 Gemini attempt ${attempt}/${maxRetries}...`);
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.4,
            topK: 40,
            topP: 0.9,
            maxOutputTokens: 3000
          }
        })
      });
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Gemini API error (${response.status}):`, errorText.slice(0, 200));
        if (attempt < maxRetries) {
          await new Promise((resolve)=>setTimeout(resolve, attempt * 1000)); // Shorter backoff
          continue;
        }
        return [];
      }
      const data = await response.json();
      const rawContent = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      if (!rawContent) {
        console.error("❌ Empty response from Gemini");
        continue;
      }
      console.log(`📥 Gemini response length: ${rawContent.length} characters`);
      const topics = extractJsonFromResponse(rawContent);
      if (topics.length > 0) {
        console.log(`✅ Successfully extracted ${topics.length} topics from Gemini`);
        return topics;
      } else {
        console.warn(`⚠️ No valid topics extracted from attempt ${attempt}`);
      }
    } catch (error) {
      console.error(`❌ Gemini attempt ${attempt} failed:`, error.message);
    }
    if (attempt < maxRetries) {
      await new Promise((resolve)=>setTimeout(resolve, attempt * 1000));
    }
  }
  console.warn("⚠️ All Gemini attempts failed");
  return [];
}
// Create meaningful fallback topics from any available content
function createFallbackTopics(text, documentId) {
  console.log("🛡️ Creating fallback topics from available content...");
  // Try to extract any meaningful words
  const words = text.split(/\s+/).filter((word)=>{
    return word.length >= 2 && /[a-zA-Z]/.test(word);
  });
  console.log(`📊 Found ${words.length} words for fallback topic generation`);
  if (words.length < 5) {
    // Very minimal content - create a basic topic
    return [
      {
        document_id: documentId,
        title: "Document Content",
        content: "This document has been uploaded and contains information that may require manual review to extract specific learning topics.",
        simplified_explanation: "Sometimes documents need manual processing to identify the key educational concepts and topics.",
        real_world_example: "In educational settings, manual review of documents can help identify important concepts that automated systems might miss.",
        keywords: [
          "document",
          "content",
          "review"
        ],
        topic_order: 0
      }
    ];
  }
  // Try to create topics from available words
  const meaningfulWords = words.filter((word)=>word.length > 3);
  const topics = [];
  // Create 2-3 topics based on content chunks
  const chunkSize = Math.max(10, Math.floor(words.length / 3));
  for(let i = 0; i < words.length && topics.length < 3; i += chunkSize){
    const chunk = words.slice(i, i + chunkSize).join(' ');
    if (chunk.length > 20) {
      // Extract some keywords from this chunk
      const chunkWords = chunk.toLowerCase().split(/\s+/);
      const wordFreq = {};
      chunkWords.forEach((word)=>{
        if (word.length > 3 && word.length < 15) {
          wordFreq[word] = (wordFreq[word] || 0) + 1;
        }
      });
      const topWords = Object.entries(wordFreq).sort(([, a], [, b])=>b - a).slice(0, 3).map(([word])=>word);
      topics.push({
        document_id: documentId,
        title: `Key Topic ${topics.length + 1}`,
        content: chunk.length > 500 ? chunk.slice(0, 500) + "..." : chunk,
        simplified_explanation: `This section contains information related to ${topWords.slice(0, 2).join(' and ')}.`,
        real_world_example: `Understanding concepts related to ${topWords[0] || 'this topic'} can be valuable in practical applications.`,
        keywords: topWords.length > 0 ? topWords : [
          'content',
          'topic'
        ],
        topic_order: topics.length
      });
    }
  }
  // Ensure we have at least one topic
  if (topics.length === 0) {
    topics.push({
      document_id: documentId,
      title: "Document Overview",
      content: words.slice(0, 100).join(' '),
      simplified_explanation: "This document contains information that has been processed for educational purposes.",
      real_world_example: "Document processing and content extraction are important skills in information management.",
      keywords: meaningfulWords.slice(0, 3).length > 0 ? meaningfulWords.slice(0, 3) : [
        'document',
        'content'
      ],
      topic_order: 0
    });
  }
  console.log(`✅ Created ${topics.length} fallback topics`);
  return topics;
}
// Main processing function
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  let documentId;
  try {
    console.log("📥 Processing document request...");
    const body = await req.json();
    const { documentId: docId, extractedText, meta, instruction } = body;
    documentId = docId;
    if (!documentId) {
      throw new Error("documentId is required");
    }
    if (!extractedText || typeof extractedText !== "string") {
      throw new Error("extractedText is required and must be a string");
    }
    console.log(`📄 Document ID: ${documentId}`);
    console.log(`📊 Text length: ${extractedText.length} characters`);
    // Update document status to processing
    await supabase.from("documents").update({
      processing_status: "processing"
    }).eq("id", documentId);
    // Clean text but be more conservative
    const cleanedText = cleanText(extractedText);
    console.log(`📊 Cleaned text length: ${cleanedText.length} characters`);
    // More lenient content check
    if (!hasMinimumContent(cleanedText)) {
      console.log("⚠️ Very minimal content, creating basic fallback topics");
      const fallbackTopics = createFallbackTopics(cleanedText, documentId);
      // Insert fallback topics
      const { error: insertError } = await supabase.from("topics").insert(fallbackTopics);
      if (insertError) {
        throw new Error(`Failed to insert fallback topics: ${insertError.message}`);
      }
      // Update document status
      await supabase.from("documents").update({
        processing_status: "completed",
        processed_at: new Date().toISOString()
      }).eq("id", documentId);
      return new Response(JSON.stringify({
        success: true,
        topics: fallbackTopics,
        message: `Document processed with ${fallbackTopics.length} topics (minimal content detected)`,
        source: "minimal_fallback"
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Try Gemini AI processing first
    console.log("🤖 Processing with Gemini AI...");
    const rawTopics = await generateTopicsWithGemini(cleanedText, documentId);
    // Validate and clean topics
    let validTopics = rawTopics.map((topic, index)=>validateTopic(topic, index, documentId)).filter((topic)=>topic !== null);
    console.log(`✅ Generated ${validTopics.length} valid topics from AI`);
    // Always supplement with fallback if we have less than 3 topics
    if (validTopics.length < 3) {
      console.log("🛡️ Supplementing with fallback topics...");
      const fallbackTopics = createFallbackTopics(cleanedText, documentId);
      // Combine AI and fallback topics, avoiding duplicates
      const combined = [
        ...validTopics
      ];
      for (const fallback of fallbackTopics){
        if (combined.length < 6) {
          combined.push({
            ...fallback,
            topic_order: combined.length
          });
        }
      }
      validTopics = combined;
    }
    // Ensure we have at least one topic
    if (validTopics.length === 0) {
      console.log("🛡️ No valid topics generated, creating emergency fallback");
      validTopics = createFallbackTopics(cleanedText, documentId);
    }
    // Insert topics into database
    console.log(`💾 Inserting ${validTopics.length} topics into database...`);
    const { error: insertError } = await supabase.from("topics").insert(validTopics);
    if (insertError) {
      throw new Error(`Database insertion failed: ${insertError.message}`);
    }
    // Update document status to completed
    await supabase.from("documents").update({
      processing_status: "completed",
      processed_at: new Date().toISOString()
    }).eq("id", documentId);
    console.log(`✅ Successfully processed document ${documentId} with ${validTopics.length} topics`);
    return new Response(JSON.stringify({
      success: true,
      topics: validTopics,
      message: `Document processed successfully with ${validTopics.length} topics`,
      source: rawTopics.length > 0 ? "gemini_ai_with_fallback" : "fallback_only"
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("❌ Processing failed:", error.message);
    // Update document status to failed if we have documentId
    if (documentId) {
      try {
        await supabase.from("documents").update({
          processing_status: "failed",
          processed_at: new Date().toISOString()
        }).eq("id", documentId);
      } catch (updateError) {
        console.error("❌ Failed to update document status:", updateError.message);
      }
    }
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      message: "Document processing failed"
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
