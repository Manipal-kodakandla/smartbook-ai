import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.56.1";
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@1.2.2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
// Basic text cleaning function
function cleanText(text) {
  if (!text || typeof text !== "string") return "";
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ").replace(/[""]/g, '"').replace(/['']/g, "'").replace(/[–—]/g, "-").replace(/…/g, "...").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n{4,}/g, "\n\n\n").replace(/[ \t]{3,}/g, "  ").trim();
}
// Robust PDF text extraction using unpdf
async function extractPdfTextUnpdf(arrayBuffer) {
  try {
    console.log("🔍 Starting PDF text extraction with unpdf (serverless PDF.js)...");
    const pdfBuffer = new Uint8Array(arrayBuffer);
    // Load PDF document
    const pdf = await getDocumentProxy(pdfBuffer);
    // Extract text with mergePages option
    const { totalPages, text } = await extractText(pdf, {
      mergePages: true
    });
    console.log(`📄 PDF processed: ${totalPages} pages found`);
    console.log(`📊 Raw extracted text length: ${text.length} characters`);
    // Clean the extracted text
    const cleanedText = cleanText(text);
    // Assess quality
    const totalChars = cleanedText.length;
    const words = cleanedText.split(/\s+/).filter((w)=>w.length > 0);
    const wordsWithLetters = words.filter((word)=>/[a-zA-Z]/.test(word));
    console.log(`📊 Extraction stats: ${totalChars} chars, ${words.length} total words, ${wordsWithLetters.length} words with letters`);
    let status = "success";
    let confidence = "high"; // unpdf with serverless PDF.js is very reliable
    if (totalChars < 20) {
      status = "minimal_text";
      confidence = "low";
    } else if (wordsWithLetters.length < 10) {
      confidence = "medium";
    }
    return {
      text: cleanedText,
      status,
      confidence,
      pages: totalPages
    };
  } catch (error) {
    console.error("❌ PDF extraction failed:", error.message);
    return {
      text: "[PDF_EXTRACTION_ERROR] Failed to extract text from PDF using unpdf",
      status: "error",
      confidence: "low",
      pages: 0
    };
  }
}
// Very lenient text quality check
function assessTextQuality(text) {
  if (!text || typeof text !== "string") {
    return {
      quality: "poor",
      shouldProcess: false,
      reason: "No text content"
    };
  }
  if (text.startsWith("[PDF_EXTRACTION_")) {
    return {
      quality: "poor",
      shouldProcess: false,
      reason: "PDF extraction failed"
    };
  }
  const totalLength = text.length;
  const words = text.split(/\s+/).filter((w)=>w.length > 0);
  const wordsWithLetters = words.filter((word)=>/[a-zA-Z]/.test(word));
  console.log(`📊 Quality assessment: ${totalLength} chars, ${words.length} total words, ${wordsWithLetters.length} words with letters`);
  // Extremely lenient criteria - if we have ANY meaningful text, try to process it
  if (totalLength < 5) {
    return {
      quality: "poor",
      shouldProcess: false,
      reason: "Text too short"
    };
  }
  if (wordsWithLetters.length < 1) {
    return {
      quality: "poor",
      shouldProcess: false,
      reason: "No words with letters found"
    };
  }
  // If we have any words with letters, try to process it
  return {
    quality: "acceptable",
    shouldProcess: true,
    reason: `Has ${wordsWithLetters.length} words with letters - attempting AI processing`
  };
}
// Function to trigger document processing
async function triggerProcessing(documentId, extractedText) {
  try {
    console.log(`🚀 Triggering processing for document ${documentId}`);
    const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/process-document`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`
      },
      body: JSON.stringify({
        documentId,
        extractedText,
        meta: {},
        instruction: "Generate educational topics from this document content, being creative with any text available."
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Processing trigger failed: ${response.status} - ${errorText}`);
    } else {
      console.log("✅ Processing triggered successfully");
    }
  } catch (error) {
    console.error("❌ Failed to trigger processing:", error.message);
  }
}
serve(async (req)=>{
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    console.log("📥 Document upload request received");
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    let fileName, fileType, fileSize, fileBuffer, userId;
    // Handle different content types
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      // FormData upload
      const formData = await req.formData();
      const file = formData.get("file");
      userId = formData.get("userId");
      if (!file || !userId) {
        return new Response(JSON.stringify({
          error: "File and userId are required"
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      fileName = file.name;
      fileType = file.type || "application/octet-stream";
      fileSize = file.size;
      fileBuffer = await file.arrayBuffer();
    } else if (contentType.includes("application/json")) {
      // JSON base64 upload
      const body = await req.json();
      const { fileBase64, name, type, size, userId: uid } = body;
      if (!fileBase64 || !uid) {
        return new Response(JSON.stringify({
          error: "fileBase64 and userId are required"
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      userId = uid;
      fileName = name || "upload.txt";
      fileType = type || "application/octet-stream";
      fileSize = size || fileBase64.length;
      fileBuffer = Uint8Array.from(atob(fileBase64), (c)=>c.charCodeAt(0)).buffer;
    } else {
      return new Response(JSON.stringify({
        error: "Unsupported content type. Use multipart/form-data or application/json"
      }), {
        status: 415,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    console.log(`📄 Processing file: ${fileName} (${fileType}, ${fileSize} bytes)`);
    // Upload to Supabase Storage (optional - continue even if it fails)
    try {
      const { error: storageError } = await supabase.storage.from("documents").upload(`${userId}/${fileName}`, new Blob([
        fileBuffer
      ], {
        type: fileType
      }), {
        upsert: true
      });
      if (storageError) {
        console.warn("⚠️ Storage upload failed:", storageError.message);
      } else {
        console.log("✅ File uploaded to storage");
      }
    } catch (error) {
      console.warn("⚠️ Storage upload error:", error.message);
    }
    // Extract text based on file type
    let extractedText = "";
    let extractionStatus = "success";
    let extractionConfidence = "medium";
    let extractionMeta = {};
    console.log("🔍 Starting text extraction...");
    if (fileType === "application/pdf") {
      console.log("📄 Processing PDF file with unpdf (serverless PDF.js)...");
      const pdfResult = await extractPdfTextUnpdf(fileBuffer);
      extractedText = pdfResult.text;
      extractionStatus = pdfResult.status;
      extractionConfidence = pdfResult.confidence;
      extractionMeta = {
        pages: pdfResult.pages,
        method: "unpdf-serverless"
      };
    } else if (fileType.startsWith("text/") || fileType === "application/json") {
      console.log("📝 Processing text file...");
      const textContent = new TextDecoder("utf-8").decode(fileBuffer);
      extractedText = cleanText(textContent);
      extractionConfidence = extractedText.length > 500 ? "high" : extractedText.length > 100 ? "medium" : "low";
      extractionMeta = {
        encoding: "utf-8"
      };
    } else {
      console.log("❓ Attempting to process as plain text...");
      try {
        const textContent = new TextDecoder("utf-8").decode(fileBuffer);
        extractedText = cleanText(textContent);
        extractionConfidence = extractedText.length > 200 ? "medium" : "low";
      } catch  {
        extractedText = "[TEXT_DECODE_ERROR] Could not decode file as text";
        extractionStatus = "error";
      }
    }
    // Assess text quality with very lenient criteria
    const qualityAssessment = assessTextQuality(extractedText);
    console.log(`📊 Text quality assessment: ${qualityAssessment.quality} - ${qualityAssessment.reason}`);
    // Insert document into database
    console.log("💾 Saving document to database...");
    const { data: document, error: docError } = await supabase.from("documents").insert([
      {
        user_id: userId,
        title: fileName.replace(/\.[^/.]+$/, ""),
        file_name: fileName,
        file_type: fileType,
        file_size: fileSize,
        extracted_text: extractedText,
        processing_status: qualityAssessment.shouldProcess ? "pending" : "completed",
        extraction_status: extractionStatus,
        extraction_confidence: extractionConfidence,
        created_at: new Date().toISOString()
      }
    ]).select().single();
    if (docError) {
      throw new Error(`Database insertion failed: ${docError.message}`);
    }
    console.log(`✅ Document saved with ID: ${document.id}`);
    // Try to trigger processing for any usable text
    if (qualityAssessment.shouldProcess && extractionStatus !== "error") {
      console.log("🚀 Triggering AI processing...");
      // Trigger processing in background (don't wait for it)
      triggerProcessing(document.id, extractedText).catch((error)=>{
        console.error("❌ Background processing failed:", error.message);
      });
    } else {
      console.log("⏭️ Skipping AI processing - no usable text content");
    }
    // Return success response
    return new Response(JSON.stringify({
      success: true,
      document: {
        id: document.id,
        title: document.title,
        file_name: fileName,
        file_type: fileType,
        file_size: fileSize,
        processing_status: document.processing_status,
        extraction_status: extractionStatus,
        extraction_confidence: extractionConfidence,
        text_length: extractedText.length,
        quality_assessment: qualityAssessment,
        extraction_meta: extractionMeta
      },
      message: qualityAssessment.shouldProcess ? "Document uploaded successfully and processing started" : "Document uploaded but no usable text content found"
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("❌ Upload failed:", error.message);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      message: "Document upload failed"
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
