import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.56.1";

// ✅ DENO-NATIVE PDF extraction using pdf-lib (no Node.js dependencies)
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

// ✅ Clean text to remove invalid Unicode sequences and control characters
function cleanExtractedText(text: string): string {
  return text
    // Remove null bytes and other control characters
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Remove incomplete Unicode escape sequences
    .replace(/\\u[0-9a-fA-F]{0,3}(?![0-9a-fA-F])/g, '')
    // Clean up common PDF artifacts
    .replace(/\\[rnt]/g, ' ')
    .replace(/\\{2,}/g, '\\')
    // Remove excessive whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

// ✅ PDF text extraction using pdf-lib (Deno-safe, TypeScript-native)
async function extractPdfTextWithPdfLib(arrayBuffer: ArrayBuffer) {
  try {
    console.log("🔄 Loading PDF with pdf-lib (Deno-native)...");
    const pdfDoc = await PDFDocument.load(arrayBuffer);
    const pageCount = pdfDoc.getPageCount();

    console.log(`✅ PDF loaded successfully. Pages: ${pageCount}`);
    const pdfBytes = await pdfDoc.save();
    const pdfString = new TextDecoder("latin1").decode(pdfBytes);

    let extractedText = "";

    // Extract text objects (Tj commands)
    const textMatches = pdfString.match(/\((.*?)\)\s*Tj/g) || [];
    textMatches.forEach(match => {
      const text = match.match(/\((.*?)\)/)?.[1];
      if (text && /[a-zA-Z0-9]/.test(text)) {
        const cleanText = text
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\t/g, "\t")
          .replace(/\\\\/g, "\\")
          .replace(/\\([()])/g, "$1");
        extractedText += cleanText + " ";
      }
    });

    extractedText = cleanExtractedText(extractedText);
    console.log(`📄 pdf-lib extraction complete. Length: ${extractedText.length}`);

    if (extractedText.length < 20) {
      return {
        text: "[PDF_LIB_MINIMAL] Minimal text found",
        method: "pdf-lib",
        status: "minimal_text",
        confidence: "low"
      };
    }

    return {
      text: extractedText,
      method: "pdf-lib",
      status: "success",
      confidence: extractedText.length > 500 ? "high" : "medium"
    };
  } catch (err) {
    console.error("❌ pdf-lib extraction failed:", err);
    return {
      text: "[PDF_LIB_ERROR] Extraction failed",
      method: "pdf-lib",
      status: "error",
      confidence: "low"
    };
  }
}

// ✅ Fallback: Manual text parsing
async function extractPdfTextManual(arrayBuffer: ArrayBuffer) {
  try {
    console.log("🔄 Manual PDF parsing...");
    const pdfString = new TextDecoder("latin1").decode(arrayBuffer);
    let extractedText = "";

    const simpleMatches = pdfString.match(/\([^)]{2,}\)/g) || [];
    simpleMatches.forEach(match => {
      const text = match.slice(1, -1);
      if (/[a-zA-Z0-9]/.test(text)) extractedText += text + " ";
    });

    extractedText = cleanExtractedText(extractedText);
    console.log(`📄 Manual extraction length: ${extractedText.length}`);

    if (extractedText.length < 20) {
      return {
        text: "[MANUAL_MINIMAL] Minimal text found",
        method: "manual",
        status: "minimal_text",
        confidence: "low"
      };
    }

    return {
      text: extractedText,
      method: "manual",
      status: "success",
      confidence: extractedText.length > 300 ? "medium" : "low"
    };
  } catch (err) {
    console.error("❌ Manual parsing failed:", err);
    return {
      text: "[MANUAL_ERROR] Failed",
      method: "manual",
      status: "error",
      confidence: "low"
    };
  }
}

// ✅ Try pdf-lib first, fallback to manual
async function extractPdfText(arrayBuffer: ArrayBuffer) {
  console.log("📄 Starting extraction...");
  const pdfLibResult = await extractPdfTextWithPdfLib(arrayBuffer);

  if (pdfLibResult.status === "success" && pdfLibResult.text.length > 50) {
    return pdfLibResult;
  }

  console.log("🔄 Trying manual parsing...");
  const manualResult = await extractPdfTextManual(arrayBuffer);
  return manualResult;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("📤 Upload request received");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const userId = formData.get("userId") as string;

    if (!file || !userId) {
      return new Response(
        JSON.stringify({ error: "File and userId are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const fileBuffer = await file.arrayBuffer();
    const fileName = file.name;
    const fileType = file.type || "application/octet-stream";
    const fileSize = file.size;

    // ✅ 1. Save original file to Supabase Storage
    const { error: storageError } = await supabase.storage
      .from("documents")
      .upload(`${userId}/${fileName}`, new Blob([fileBuffer], { type: fileType }), { upsert: true });

    if (storageError) {
      console.error("⚠️ Storage upload failed:", storageError);
    }

    let extractedText = "";
    let extractionStatus = "success";
    let extractionMethod = "unknown";
    let extractionConfidence = "low";

    if (fileType === "text/plain") {
      extractedText = cleanExtractedText(new TextDecoder().decode(fileBuffer));
      extractionMethod = "text-decoder";
      extractionConfidence = extractedText.length > 200 ? "high" : "medium";
    } else if (fileType === "application/pdf") {
      const pdfResult = await extractPdfText(fileBuffer);
      extractedText = pdfResult.text;
      extractionMethod = pdfResult.method;
      extractionStatus = pdfResult.status;
      extractionConfidence = pdfResult.confidence;
    } else {
      extractedText = `[UNSUPPORTED] File type '${fileType}'`;
      extractionStatus = "unsupported";
      extractionMethod = "none";
      extractionConfidence = "low";
    }

    // ✅ 2. Store document + metadata
    const { data: document, error: docError } = await supabase
      .from("documents")
      .insert([{
        user_id: userId,
        title: fileName.replace(/\.[^/.]+$/, ""),
        file_name: fileName,
        file_type: fileType,
        file_size: fileSize,
        extracted_text: extractedText,
        processing_status: "processing",
        extraction_status: extractionStatus,
        extraction_method: extractionMethod,
        extraction_confidence: extractionConfidence
      }])
      .select()
      .single();

    if (docError) {
      throw new Error(`DB insert failed: ${docError.message}`);
    }

    console.log(`✅ Document saved: ${document.id}`);

    // ✅ 3. AI Processing (only if text is useful)
    const hasUsefulText =
      extractedText.length > 50 &&
      extractionStatus === "success" &&
      !extractedText.startsWith("[");

    if (hasUsefulText) {
      console.log("🤖 Invoking AI processing...");
      await supabase.functions.invoke("process-document", {
        body: JSON.stringify({
          documentId: document.id,
          extractedText: extractedText.slice(0, 120_000),
          meta: { fileName, fileType, extractionMethod, extractionStatus, extractionConfidence },
          instruction:
            "Summaries and answers must stay faithful to extracted text. Ignore formatting errors. If text is incomplete, say so clearly."
        })
      });
    } else {
      await supabase
        .from("documents")
        .update({ processing_status: "completed", processed_at: new Date().toISOString() })
        .eq("id", document.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        document,
        extraction: { status: extractionStatus, method: extractionMethod, confidence: extractionConfidence, length: extractedText.length },
        message: hasUsefulText
          ? `✅ Extracted with ${extractionMethod} (confidence: ${extractionConfidence}). AI started.`
          : `📄 Uploaded but insufficient text (status: ${extractionStatus}).`
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("💥 Global error:", error);
    return new Response(
      JSON.stringify({ error: error.message || String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
