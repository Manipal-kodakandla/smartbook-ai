import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.56.1";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

// Simplified text cleaning function
function cleanText(text: string): string {
  if (!text || typeof text !== "string") return "";
  
  return text
    // Remove control characters but preserve line breaks
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    // Normalize common Unicode characters
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    // Clean up whitespace
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
}

// Simplified PDF text extraction
async function extractPdfText(arrayBuffer: ArrayBuffer): Promise<{
  text: string;
  status: string;
  confidence: string;
  pages: number;
}> {
  try {
    console.log("🔍 Starting PDF text extraction...");
    const pdfDoc = await PDFDocument.load(arrayBuffer);
    const pageCount = pdfDoc.getPageCount();
    console.log(`📄 PDF loaded: ${pageCount} pages`);

    // Convert PDF to string for text extraction
    const pdfBytes = await pdfDoc.save();
    const pdfString = new TextDecoder("latin1").decode(pdfBytes);
    
    let extractedText = "";
    
    // Method 1: Extract text from Tj operators (most common)
    const tjMatches = pdfString.match(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g) || [];
    console.log(`🔍 Found ${tjMatches.length} Tj operators`);
    
    for (const match of tjMatches) {
      const textMatch = match.match(/\(((?:[^()\\]|\\.)*)\)/);
      if (textMatch && textMatch[1]) {
        let text = textMatch[1]
          .replace(/\\n/g, " ")
          .replace(/\\r/g, " ")
          .replace(/\\t/g, " ")
          .replace(/\\\(/g, "(")
          .replace(/\\\)/g, ")")
          .replace(/\\\\/g, "\\");
        
        // Basic filtering - keep text that looks like words
        if (text.length >= 2 && /[a-zA-Z]/.test(text)) {
          extractedText += text + " ";
        }
      }
    }
    
    // Method 2: Extract from TJ arrays if Tj didn't work well
    if (extractedText.length < 100) {
      console.log("🔍 Trying TJ array extraction...");
      const tjArrayMatches = pdfString.match(/\[((?:[^\[\]\\]|\\.)*)\]\s*TJ/g) || [];
      
      for (const match of tjArrayMatches) {
        const arrayContent = match.match(/\[((?:[^\[\]\\]|\\.)*)\]/);
        if (arrayContent && arrayContent[1]) {
          const textParts = arrayContent[1].match(/\(((?:[^()\\]|\\.)*)\)/g) || [];
          for (const part of textParts) {
            const text = part.slice(1, -1); // Remove parentheses
            if (text.length >= 2 && /[a-zA-Z]/.test(text)) {
              extractedText += text + " ";
            }
          }
        }
      }
    }
    
    // Clean the extracted text
    extractedText = cleanText(extractedText);
    
    // Assess quality
    const words = extractedText.split(/\s+/).filter(w => w.length > 0);
    const meaningfulWords = words.filter(word => {
      const clean = word.replace(/[^\w]/g, '');
      return clean.length >= 2 && /[a-zA-Z]/.test(clean);
    });
    
    const qualityRatio = meaningfulWords.length / Math.max(words.length, 1);
    
    console.log(`📊 Extraction stats: ${extractedText.length} chars, ${words.length} words, ${meaningfulWords.length} meaningful words`);
    console.log(`📊 Quality ratio: ${qualityRatio.toFixed(2)}`);
    
    let status = "success";
    let confidence = "medium";
    
    if (extractedText.length < 50) {
      status = "minimal_text";
      confidence = "low";
    } else if (qualityRatio > 0.7 && extractedText.length > 500) {
      confidence = "high";
    } else if (qualityRatio < 0.3) {
      confidence = "low";
    }
    
    return {
      text: extractedText,
      status,
      confidence,
      pages: pageCount
    };
    
  } catch (error) {
    console.error("❌ PDF extraction failed:", error.message);
    return {
      text: "[PDF_EXTRACTION_ERROR] Failed to extract text from PDF",
      status: "error",
      confidence: "low",
      pages: 0
    };
  }
}

// Simple text quality check
function assessTextQuality(text: string): {
  quality: string;
  shouldProcess: boolean;
  reason: string;
} {
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
  
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const meaningfulWords = words.filter(word => {
    const clean = word.replace(/[^\w]/g, '');
    return clean.length >= 2 && /[a-zA-Z]/.test(clean);
  });
  
  const meaningfulRatio = meaningfulWords.length / Math.max(words.length, 1);
  
  console.log(`📊 Text quality: ${words.length} words, ${meaningfulWords.length} meaningful, ratio: ${meaningfulRatio.toFixed(2)}`);
  
  if (text.length < 30) {
    return {
      quality: "poor",
      shouldProcess: false,
      reason: "Text too short"
    };
  }
  
  if (meaningfulWords.length < 10) {
    return {
      quality: "poor",
      shouldProcess: false,
      reason: "Too few meaningful words"
    };
  }
  
  if (meaningfulRatio > 0.5) {
    return {
      quality: "good",
      shouldProcess: true,
      reason: `Good quality: ${meaningfulWords.length} meaningful words`
    };
  }
  
  if (meaningfulRatio > 0.3 && meaningfulWords.length >= 20) {
    return {
      quality: "fair",
      shouldProcess: true,
      reason: `Fair quality: ${meaningfulWords.length} meaningful words`
    };
  }
  
  return {
    quality: "poor",
    shouldProcess: false,
    reason: `Low quality: only ${meaningfulWords.length} meaningful words`
  };
}

// Function to trigger document processing
async function triggerProcessing(documentId: string, extractedText: string): Promise<void> {
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
        instruction: "Generate educational topics from this document content."
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

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("📥 Document upload request received");
    
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    let fileName: string, fileType: string, fileSize: number, fileBuffer: ArrayBuffer, userId: string;

    // Handle different content types
    const contentType = req.headers.get("content-type") || "";
    
    if (contentType.includes("multipart/form-data")) {
      // FormData upload
      const formData = await req.formData();
      const file = formData.get("file") as File;
      userId = formData.get("userId") as string;

      if (!file || !userId) {
        return new Response(JSON.stringify({
          error: "File and userId are required"
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
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
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      userId = uid;
      fileName = name || "upload.txt";
      fileType = type || "application/octet-stream";
      fileSize = size || fileBase64.length;
      fileBuffer = Uint8Array.from(atob(fileBase64), c => c.charCodeAt(0)).buffer;
      
    } else {
      return new Response(JSON.stringify({
        error: "Unsupported content type. Use multipart/form-data or application/json"
      }), {
        status: 415,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    console.log(`📄 Processing file: ${fileName} (${fileType}, ${fileSize} bytes)`);

    // Upload to Supabase Storage (optional - continue even if it fails)
    try {
      const { error: storageError } = await supabase.storage
        .from("documents")
        .upload(`${userId}/${fileName}`, new Blob([fileBuffer], { type: fileType }), {
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
      console.log("📄 Processing PDF file...");
      const pdfResult = await extractPdfText(fileBuffer);
      extractedText = pdfResult.text;
      extractionStatus = pdfResult.status;
      extractionConfidence = pdfResult.confidence;
      extractionMeta = { pages: pdfResult.pages };
      
    } else if (fileType.startsWith("text/") || fileType === "application/json") {
      console.log("📝 Processing text file...");
      const textContent = new TextDecoder("utf-8").decode(fileBuffer);
      extractedText = cleanText(textContent);
      extractionConfidence = extractedText.length > 500 ? "high" : 
                            extractedText.length > 100 ? "medium" : "low";
      extractionMeta = { encoding: "utf-8" };
      
    } else {
      console.log("❓ Attempting to process as plain text...");
      try {
        const textContent = new TextDecoder("utf-8").decode(fileBuffer);
        extractedText = cleanText(textContent);
        extractionConfidence = extractedText.length > 200 ? "medium" : "low";
      } catch {
        extractedText = "[TEXT_DECODE_ERROR] Could not decode file as text";
        extractionStatus = "error";
      }
    }

    // Assess text quality
    const qualityAssessment = assessTextQuality(extractedText);
    console.log(`📊 Text quality assessment: ${qualityAssessment.quality} - ${qualityAssessment.reason}`);

    // Insert document into database
    console.log("💾 Saving document to database...");
    const { data: document, error: docError } = await supabase
      .from("documents")
      .insert([{
        user_id: userId,
        title: fileName.replace(/\.[^/.]+$/, ""), // Remove file extension
        file_name: fileName,
        file_type: fileType,
        file_size: fileSize,
        extracted_text: extractedText,
        processing_status: qualityAssessment.shouldProcess ? "pending" : "completed",
        extraction_status: extractionStatus,
        extraction_confidence: extractionConfidence,
        created_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (docError) {
      throw new Error(`Database insertion failed: ${docError.message}`);
    }

    console.log(`✅ Document saved with ID: ${document.id}`);

    // Trigger processing if text quality is good
    if (qualityAssessment.shouldProcess && extractionStatus === "success") {
      console.log("🚀 Text quality is good, triggering AI processing...");
      // Trigger processing in background (don't wait for it)
      triggerProcessing(document.id, extractedText).catch(error => {
        console.error("❌ Background processing failed:", error.message);
      });
    } else {
      console.log("⏭️ Skipping AI processing due to text quality issues");
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
        quality_assessment: qualityAssessment
      },
      message: qualityAssessment.shouldProcess 
        ? "Document uploaded successfully and processing started"
        : "Document uploaded but text quality is too low for AI processing"
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("❌ Upload failed:", error.message);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      message: "Document upload failed"
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

