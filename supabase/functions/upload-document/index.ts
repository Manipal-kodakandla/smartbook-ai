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

// ✅ Hybrid PDF text extractor (Tj + TJ + BT/ET)
async function extractPdfText(arrayBuffer: ArrayBuffer) {
  try {
    console.log("🔄 Extracting PDF text...");
    const pdfDoc = await PDFDocument.load(arrayBuffer);
    const pageCount = pdfDoc.getPageCount();
    console.log(`✅ PDF loaded. Pages: ${pageCount}`);

    const pdfBytes = await pdfDoc.save();
    const pdfString = new TextDecoder("latin1").decode(pdfBytes);

    let extractedText = "";

    // --- Method 1: Simple Tj matches
    const tjMatches = pdfString.match(/\((.*?)\)\s*Tj/g) || [];
    tjMatches.forEach((match) => {
      const text = match.match(/\((.*?)\)/)?.[1];
      if (text && /[a-zA-Z0-9]/.test(text)) extractedText += text + " ";
    });

    // --- Method 2: TJ arrays
    const tjArrayMatches = pdfString.match(/\[(.*?)\]\s*TJ/g) || [];
    tjArrayMatches.forEach((match) => {
      const parts = match.match(/\((.*?)\)/g) || [];
      parts.forEach((p) => {
        const text = p.slice(1, -1);
        if (/[a-zA-Z0-9]/.test(text)) extractedText += text + " ";
      });
    });

    // --- Method 3: Capture raw BT..ET blocks
    const blockMatches = pdfString.match(/BT([\s\S]*?)ET/g) || [];
    blockMatches.forEach((block) => {
      const textParts = block.match(/\((.*?)\)/g) || [];
      textParts.forEach((p) => {
        const text = p.slice(1, -1);
        if (/[a-zA-Z0-9]/.test(text)) extractedText += text + " ";
      });
    });

    extractedText = cleanExtractedText(extractedText);
    console.log(`📄 Extracted text length: ${extractedText.length}`);

    if (extractedText.length < 50) {
      return {
        text: "[PDF_EXTRACTION_MINIMAL] Too little text extracted",
        method: "hybrid",
        status: "minimal_text",
        confidence: "low",
      };
    }

    return {
      text: extractedText,
      method: "hybrid",
      status: "success",
      confidence: extractedText.length > 1000 ? "high" : "medium",
    };
  } catch (err) {
    console.error("❌ PDF extraction failed:", err);
    return {
      text: "[PDF_EXTRACTION_ERROR] Failed",
      method: "hybrid",
      status: "error",
      confidence: "low",
    };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    console.log("📤 Upload request received");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    let fileName, fileType, fileSize, fileBuffer, userId;
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file");
      userId = formData.get("userId");

      if (!file || !userId) {
        return new Response(JSON.stringify({ error: "File and userId are required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      fileName = file.name;
      fileType = file.type || "application/octet-stream";
      fileSize = file.size;
      fileBuffer = await file.arrayBuffer();
    } else {
      return new Response(JSON.stringify({ error: "Unsupported content type" }), {
        status: 415,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ✅ Upload to Supabase Storage
    await supabase.storage
      .from("documents")
      .upload(`${userId}/${fileName}`, new Blob([fileBuffer], { type: fileType }), {
        upsert: true,
      });

    // ✅ Extract text
    let extractedText = "";
    let extractionMethod = "unknown";
    let extractionStatus = "success";
    let extractionConfidence = "low";

    if (fileType === "application/pdf") {
      const pdfResult = await extractPdfText(fileBuffer);
      extractedText = pdfResult.text;
      extractionMethod = pdfResult.method;
      extractionStatus = pdfResult.status;
      extractionConfidence = pdfResult.confidence;
    }

    // ✅ Insert document into DB
    const { data: document, error: docError } = await supabase
      .from("documents")
      .insert([
        {
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
        },
      ])
      .select()
      .single();

    if (docError) throw new Error(`DB insert failed: ${docError.message}`);
    console.log(`✅ Document saved: ${document.id}`);

    // ✅ Trigger AI processing if text looks useful
    const hasUsefulText = extractedText.length > 50 && extractionStatus === "success";
    if (hasUsefulText) {
      await supabase.functions.invoke("process-document", {
        body: {
          documentId: document.id,
          extractedText: extractedText.slice(0, 120_000),
          meta: { fileName, fileType, extractionMethod, extractionStatus, extractionConfidence },
          instruction: "Summaries must stay faithful to extracted text. If unclear, mark it.",
        },
      });
    } else {
      await supabase.from("documents").update({
        processing_status: "completed",
        processed_at: new Date().toISOString(),
      }).eq("id", document.id);
    }

    return new Response(JSON.stringify({ success: true, document }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("💥 Global error:", error);
    return new Response(JSON.stringify({ error: error.message || String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
