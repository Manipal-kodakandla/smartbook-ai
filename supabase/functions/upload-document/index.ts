import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.56.1";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// 🧹 Enhanced text cleaning with better Unicode handling
function cleanExtractedText(text: string): string {
  if (!text || typeof text !== "string") return "";
  
  return text
    // Remove control characters but preserve line breaks
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    // Fix common PDF encoding issues
    .replace(/\\u[0-9a-fA-F]{0,3}(?![0-9a-fA-F])/g, "")
    .replace(/\\[rnt]/g, " ")
    .replace(/\\{2,}/g, "\\")
    // Normalize Unicode characters
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    // Clean up whitespace while preserving paragraph structure
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
}

// 🔍 Enhanced PDF text extraction with multiple fallback methods
async function extractPdfText(arrayBuffer: ArrayBuffer) {
  try {
    console.log("🔄 Starting enhanced PDF text extraction...");
    const pdfDoc = await PDFDocument.load(arrayBuffer);
    const pageCount = pdfDoc.getPageCount();
    console.log(`✅ PDF loaded successfully. Pages: ${pageCount}`);

    const pdfBytes = await pdfDoc.save();
    const pdfString = new TextDecoder("latin1").decode(pdfBytes);

    let extractedText = "";
    let extractionMethods = [];

    // Method 1: Enhanced Tj operator extraction
    console.log("🔍 Extracting text using Tj operators...");
    const tjMatches = pdfString.match(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g) || [];
    let tjText = "";
    tjMatches.forEach((match) => {
      const textMatch = match.match(/\(((?:[^()\\]|\\.)*)\)/);
      if (textMatch && textMatch[1]) {
        let text = textMatch[1]
          .replace(/\\n/g, " ")
          .replace(/\\r/g, " ")
          .replace(/\\t/g, " ")
          .replace(/\\\(/g, "(")
          .replace(/\\\)/g, ")")
          .replace(/\\\\/g, "\\");
        
        if (text && /[a-zA-Z0-9]/.test(text) && text.length > 1) {
          tjText += text + " ";
        }
      }
    });
    if (tjText.length > 50) {
      extractedText += tjText;
      extractionMethods.push("Tj");
    }

    // Method 2: Enhanced TJ array extraction
    console.log("🔍 Extracting text using TJ arrays...");
    const tjArrayMatches = pdfString.match(/\[((?:[^\[\]\\]|\\.)*)\]\s*TJ/g) || [];
    let tjArrayText = "";
    tjArrayMatches.forEach((match) => {
      const arrayContent = match.match(/\[((?:[^\[\]\\]|\\.)*)\]/);
      if (arrayContent && arrayContent[1]) {
        const textParts = arrayContent[1].match(/\(((?:[^()\\]|\\.)*)\)/g) || [];
        textParts.forEach((part) => {
          const text = part.slice(1, -1);
          if (text && /[a-zA-Z0-9]/.test(text) && text.length > 1) {
            tjArrayText += text + " ";
          }
        });
      }
    });
    if (tjArrayText.length > 50) {
      extractedText += " " + tjArrayText;
      extractionMethods.push("TJ");
    }

    // Method 3: Enhanced BT...ET block extraction
    console.log("🔍 Extracting text using BT...ET blocks...");
    const blockMatches = pdfString.match(/BT([\s\S]*?)ET/g) || [];
    let blockText = "";
    blockMatches.forEach((block) => {
      // Extract text from various text-showing operators
      const textOperators = block.match(/\(((?:[^()\\]|\\.)*)\)\s*(?:Tj|TJ|'|")/g) || [];
      textOperators.forEach((op) => {
        const text = op.match(/\(((?:[^()\\]|\\.)*)\)/)?.[1];
        if (text && /[a-zA-Z0-9]/.test(text) && text.length > 1) {
          blockText += text + " ";
        }
      });
    });
    if (blockText.length > 50) {
      extractedText += " " + blockText;
      extractionMethods.push("BT-ET");
    }

    // Method 4: Stream object extraction (fallback)
    if (extractedText.length < 100) {
      console.log("🔍 Using stream object fallback extraction...");
      const streamMatches = pdfString.match(/stream\s*([\s\S]*?)\s*endstream/g) || [];
      let streamText = "";
      streamMatches.forEach((stream) => {
        const content = stream.replace(/^stream\s*|\s*endstream$/g, "");
        const textMatches = content.match(/\b[A-Za-z][A-Za-z0-9\s]{2,}[A-Za-z0-9]\b/g) || [];
        textMatches.forEach((match) => {
          if (match.length > 3 && !/^[0-9\s]+$/.test(match)) {
            streamText += match + " ";
          }
        });
      });
      if (streamText.length > 50) {
        extractedText += " " + streamText;
        extractionMethods.push("Stream");
      }
    }

    // Clean and validate extracted text
    extractedText = cleanExtractedText(extractedText);
    console.log(`📄 Extracted text length: ${extractedText.length}`);
    console.log(`🔧 Methods used: ${extractionMethods.join(", ")}`);

    // Determine extraction quality
    let confidence = "low";
    let status = "success";
    
    if (extractedText.length > 2000) {
      confidence = "high";
    } else if (extractedText.length > 500) {
      confidence = "medium";
    } else if (extractedText.length < 50) {
      status = "minimal_text";
      extractedText = "[PDF_EXTRACTION_MINIMAL] Limited text content extracted from PDF";
    }

    // Check if text looks meaningful
    const words = extractedText.split(/\s+/).filter(w => w.length > 2);
    const meaningfulWords = words.filter(w => /^[a-zA-Z]+$/.test(w));
    const meaningfulRatio = meaningfulWords.length / Math.max(words.length, 1);
    
    if (meaningfulRatio < 0.3 && extractedText.length > 50) {
      console.warn("⚠️ Text may contain encoding issues or be corrupted");
      confidence = "low";
    }

    return {
      text: extractedText,
      method: `hybrid(${extractionMethods.join(",")})`,
      status: status,
      confidence: confidence,
      pages: pageCount,
      methods_used: extractionMethods.length
    };

  } catch (err) {
    console.error("❌ PDF extraction failed:", err.message);
    return {
      text: "[PDF_EXTRACTION_ERROR] Failed to extract text from PDF",
      method: "hybrid",
      status: "error",
      confidence: "low",
      pages: 0,
      methods_used: 0
    };
  }
}

// 📊 Analyze text quality for processing decisions
function analyzeTextQuality(text: string) {
  if (!text || typeof text !== "string") {
    return { quality: "poor", shouldProcess: false, reason: "No text content" };
  }

  const words = text.split(/\s+/).filter(w => w.length > 0);
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
  const meaningfulWords = words.filter(w => /^[a-zA-Z]{2,}$/.test(w));
  
  const stats = {
    length: text.length,
    words: words.length,
    sentences: sentences.length,
    meaningfulWords: meaningfulWords.length,
    avgWordLength: meaningfulWords.reduce((sum, w) => sum + w.length, 0) / Math.max(meaningfulWords.length, 1),
    meaningfulRatio: meaningfulWords.length / Math.max(words.length, 1)
  };

  console.log("📊 Text quality analysis:", stats);

  // Determine if we should process this text
  if (stats.length < 50) {
    return { quality: "poor", shouldProcess: false, reason: "Text too short", stats };
  }
  
  if (stats.meaningfulRatio < 0.2) {
    return { quality: "poor", shouldProcess: false, reason: "Too much garbage text", stats };
  }
  
  if (stats.words < 10) {
    return { quality: "poor", shouldProcess: false, reason: "Too few words", stats };
  }

  let quality = "good";
  if (stats.length > 1000 && stats.sentences > 5 && stats.meaningfulRatio > 0.6) {
    quality = "excellent";
  } else if (stats.length > 200 && stats.sentences > 2) {
    quality = "good";
  } else {
    quality = "fair";
  }

  return { 
    quality, 
    shouldProcess: true, 
    reason: `Quality: ${quality}`,
    stats 
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("📤 Document upload request received");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    let fileName, fileType, fileSize, fileBuffer, userId;

    // Auto-detect content type
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      // FormData upload
      const formData = await req.formData();
      const file = formData.get("file");
      userId = formData.get("userId");

      if (!file || !userId) {
        return new Response(
          JSON.stringify({ error: "File and userId are required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
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
        return new Response(
          JSON.stringify({ error: "fileBase64 and userId are required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      userId = uid;
      fileName = name || "upload.txt";
      fileType = type || "application/octet-stream";
      fileSize = size || fileBase64.length;
      fileBuffer = Uint8Array.from(atob(fileBase64), (c) =>
        c.charCodeAt(0)
      ).buffer;

    } else {
      return new Response(
        JSON.stringify({ error: "Unsupported content type" }),
        {
          status: 415,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`📄 Processing file: ${fileName} (${fileType}, ${fileSize} bytes)`);

    // Upload to Supabase Storage
    console.log("☁️ Uploading to Supabase storage...");
    const { error: storageError } = await supabase.storage
      .from("documents")
      .upload(`${userId}/${fileName}`, new Blob([fileBuffer], { type: fileType }), {
        upsert: true,
      });

    if (storageError) {
      console.warn("⚠️ Storage upload failed:", storageError.message);
      // Continue processing even if storage fails
    }

    // Extract text based on file type
    let extractedText = "";
    let extractionMethod = "unknown";
    let extractionStatus = "success";
    let extractionConfidence = "low";
    let extractionMeta = {};

    console.log("🔄 Starting text extraction...");

    if (fileType === "application/pdf") {
      console.log("📄 Processing PDF file...");
      const pdfResult = await extractPdfText(fileBuffer);
      extractedText = pdfResult.text;
      extractionMethod = pdfResult.method;
      extractionStatus = pdfResult.status;
      extractionConfidence = pdfResult.confidence;
      extractionMeta = {
        pages: pdfResult.pages,
        methods_used: pdfResult.methods_used
      };

    } else if (fileType.startsWith("text/") || fileType === "application/json") {
      console.log("📝 Processing text file...");
      const textContent = new TextDecoder("utf-8").decode(fileBuffer);
      extractedText = cleanExtractedText(textContent);
      extractionMethod = "text-decoder";
      extractionConfidence = extractedText.length > 500 ? "high" : 
                            extractedText.length > 100 ? "medium" : "low";
      extractionMeta = { encoding: "utf-8" };

    } else if (fileType.includes("plain") || !fileType.includes("/")) {
      console.log("📋 Processing as plain text...");
      // Try to decode as text anyway
      try {
        const textContent = new TextDecoder("utf-8").decode(fileBuffer);
        extractedText = cleanExtractedText(textContent);
        extractionMethod = "text-fallback";
        extractionConfidence = extractedText.length > 200 ? "medium" : "low";
      } catch {
        extractedText = "[TEXT_DECODE_ERROR] Could not decode file as text";
        extractionStatus = "error";
      }

    } else {
      console.log("❌ Unsupported file type for text extraction");
      extractedText = `[UNSUPPORTED_TYPE] File type '${fileType}' is not supported for text extraction`;
      extractionStatus = "unsupported";
    }

    // Analyze text quality
    const qualityAnalysis = analyzeTextQuality(extractedText);
    console.log(`📊 Text quality: ${qualityAnalysis.quality} - ${qualityAnalysis.reason}`);

    // Insert document into database
    console.log("💾 Saving document to database...");
    const { data: document, error: docError } = await supabase
      .from("documents")
      .insert([
        {
          user_id: userId,
          title: fileName.replace(/\.[^/.]+$/, ""), // Remove file extension
          file_name: fileName,
          file_type: fileType,
          file_size: fileSize,
          extracted_text: extractedText,
          processing_status: "processing",
          extraction_status: extractionStatus,
          extraction_method: extractionMethod,
          extraction_confidence: extractionConfidence,
          created_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (docError) {
      throw new Error(`Database insertion failed: ${docError.message}`);
    }

    console.log(`✅ Document saved with ID: ${document.id}`);

    // Determine if we should process with AI
    const shouldProcessWithAI = qualityAnalysis.shouldProcess && 
                               extractionStatus === "success" &&
                               extractedText.length > 50 &&
                               !extractedText.startsWith("[");

    console.log(`🤖 Should process with AI: ${shouldProcessWithAI}`);
    console.log(`📏 Text length: ${extractedText.length}`);
    console.log(`🎯 Extraction status: ${extractionStatus}`);

    if (shouldProcessWithAI) {
      console.log("🚀 Triggering AI processing...");
      
      // Enhanced AI processing with retry logic
      const processWithAI = async (retryCount = 0) => {
        const maxRetries = 2;
        
        try {
          const { data: processResult, error: processError } = await supabase.functions.invoke(
            "process-document",
            {
              body: {
                documentId: document.id,
                extractedText: extractedText.slice(0, 120_000), // Limit size for API
                meta: {
                  fileName,
                  fileType,
                  extractionMethod,
                  extractionStatus,
                  extractionConfidence,
                  qualityAnalysis,
                  ...extractionMeta
                },
                instruction: `Create educational topics from this ${fileType === 'application/pdf' ? 'PDF' : 'document'}. Focus on key concepts that students can learn and practice. Ignore any formatting errors and extract meaningful educational content.`
              },
            }
          );

          if (processError) {
            console.error(`❌ AI processing error (attempt ${retryCount + 1}):`, processError);
            
            if (retryCount < maxRetries) {
              console.log(`🔄 Retrying AI processing... (${retryCount + 1}/${maxRetries})`);
              await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 2000));
              return await processWithAI(retryCount + 1);
            } else {
              // Final retry failed - update document status
              console.error("❌ All AI processing attempts failed");
              await supabase
                .from("documents")
                .update({
                  processing_status: "failed",
                  processed_at: new Date().toISOString(),
                })
                .eq("id", document.id);
              
              return { success: false, error: processError };
            }
          } else {
            console.log("✅ AI processing completed successfully");
            return { success: true, result: processResult };
          }
        } catch (error) {
          console.error(`❌ AI processing exception (attempt ${retryCount + 1}):`, error);
          
          if (retryCount < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 2000));
            return await processWithAI(retryCount + 1);
          } else {
            await supabase
              .from("documents")
              .update({
                processing_status: "failed",
                processed_at: new Date().toISOString(),
              })
              .eq("id", document.id);
            
            return { success: false, error: error.message };
          }
        }
      };

      // Execute AI processing
      const aiResult = await processWithAI();
      
      if (!aiResult.success) {
        console.warn("⚠️ AI processing failed, but document was saved successfully");
      }

    } else {
      console.log("⏭️ Skipping AI processing - insufficient or invalid text");
      await supabase
        .from("documents")
        .update({
          processing_status: "completed",
          processed_at: new Date().toISOString(),
        })
        .eq("id", document.id);
    }

    // Prepare response
    const responseMessage = shouldProcessWithAI
      ? `✅ Document uploaded successfully! Text extracted using ${extractionMethod} (${extractionConfidence} confidence). AI processing started.`
      : `📄 Document uploaded but AI processing skipped. ${qualityAnalysis.reason}. Status: ${extractionStatus}.`;

    return new Response(
      JSON.stringify({
        success: true,
        document: {
          id: document.id,
          title: document.title,
          fileName: document.file_name,
          fileType: document.file_type,
          fileSize: document.file_size,
          processingStatus: document.processing_status,
        },
        extraction: {
          status: extractionStatus,
          method: extractionMethod,
          confidence: extractionConfidence,
          textLength: extractedText.length,
          quality: qualityAnalysis.quality,
          ...extractionMeta
        },
        processing: {
          aiProcessing: shouldProcessWithAI,
          reason: qualityAnalysis.reason
        },
        message: responseMessage,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("💥 Upload processing failed:", error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Unknown error occurred",
        message: "Document upload failed. Please try again."
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
