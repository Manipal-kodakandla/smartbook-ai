import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.56.1";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ✅ Clean extracted text
function cleanExtractedText(text: string) {
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/\\u[0-9a-fA-F]{0,3}(?![0-9a-fA-F])/g, "")
    .replace(/\\[rnt]/g, " ")
    .replace(/\\{2,}/g, "\\")
    .replace(/\s+/g, " ")
    .trim();
}

// ✅ Extract text with pdf-lib
async function extractPdfTextWithPdfLib(arrayBuffer: ArrayBuffer) {
  try {
    const pdfDoc = await PDFDocument.load(arrayBuffer);
    const pdfBytes = await pdfDoc.save();
    const pdfString = new TextDecoder("latin1").decode(pdfBytes);
    let extractedText = "";

    const textMatches = pdfString.match(/\((.*?)\)\s*Tj/g) || [];
    textMatches.forEach((match) => {
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

    return {
      text: extractedText || "[PDF_LIB_EMPTY]",
      method: "pdf-lib",
      status: extractedText.length > 20 ? "success" : "minimal_text",
      confidence: extractedText.length > 500 ? "high" : "medium",
    };
  } catch (err) {
    console.error("❌ pdf-lib failed:", err);
    return { text: "[PDF_LIB_ERROR]", method: "pdf-lib", status: "error", confidence: "low" };
  }
}

// ✅ Manual fallback
async function extractPdfTextManual(arrayBuffer: ArrayBuffer) {
  try {
    const pdfString = new TextDecoder("latin1").decode(arrayBuffer);
    let extractedText = "";
    const matches = pdfString.match(/\([^)]{2,}\)/g) || [];
    matches.forEach((match) => {
      const text = match.slice(1, -1);
      if (/[a-zA-Z0-9]/.test(text)) extractedText += text + " ";
    });

    extractedText = cleanExtractedText(extractedText);

    return {
      text: extractedText || "[MANUAL_EMPTY]",
      method: "manual",
      status: extractedText.length > 20 ? "success" : "minimal_text",
      confidence: extractedText.length > 300 ? "medium" : "low",
    };
  } catch (err) {
    console.error("❌ Manual parse failed:", err);
    return { text: "[MANUAL_ERROR]", method: "manual", status: "error", confidence: "low" };
  }
}

// ✅ Try pdf-lib → fallback to manual
async function extractPdfText(arrayBuffer: ArrayBuffer) {
  const pdfLibResult = await extractPdfTextWithPdfLib(arrayBuffer);
  if (pdfLibResult.status === "success" && pdfLibResult.text.length > 50) {
    return pdfLibResult;
  }
  return await extractPdfTextManual(arrayBuffer);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const userId = formData.get("userId") as string | null;

    if (!file || !userId) {
      return new Response(JSON.stringify({ error: "File and userId are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fileBuffer = await file.arrayBuffer();
    const fileName = file.name;
    const fileType = file.type || "application/octet-stream";
    const fileSize = file.size;

    // ✅ Upload to Supabase Storage
    const { error: storageError } = await supabase.storage
      .from("documents")
      .upload(`${userId}/${fileName}`, new Blob([fileBuffer], { type: fileType }), { upsert: true });

    if (storageError) console.error("⚠️ Storage upload failed:", storageError);

    // ✅ Extract text
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
      extractedText = `[UNSUPPORTED] ${fileType}`;
      extractionStatus = "unsupported";
      extractionMethod = "none";
      extractionConfidence = "low";
    }

    // ✅ Save doc metadata
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
        extraction_confidence: extractionConfidence,
      }])
      .select()
      .single();

    if (docError) throw new Error(`DB insert failed: ${docError.message}`);

    // ✅ Check if text is useful (NEW guard)
    const looksLikeGibberish = !/[a-zA-Z]{5,}/.test(extractedText);
    const hasUsefulText =
      extractedText.length > 100 &&
      extractionStatus === "success" &&
      !extractedText.startsWith("[") &&
      !looksLikeGibberish;

    if (hasUsefulText) {
      await supabase.functions.invoke("process-document", {
        body: JSON.stringify({
          documentId: document.id,
          extractedText: extractedText.slice(0, 120_000),
          meta: { fileName, fileType, extractionMethod, extractionStatus, extractionConfidence },
          instruction: "Summaries must stay faithful to text. If incomplete, clearly say so.",
        }),
      });
    } else {
      await supabase.from("documents").update({
        processing_status: "completed",
        processed_at: new Date().toISOString(),
      }).eq("id", document.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        document,
        extraction: { status: extractionStatus, method: extractionMethod, confidence: extractionConfidence, length: extractedText.length },
        message: hasUsefulText ? `✅ Extracted with ${extractionMethod}. AI started.` : `📄 Uploaded but insufficient text (status: ${extractionStatus}).`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("💥 Upload error:", error);
    return new Response(JSON.stringify({ error: error.message || String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
