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

// ✅ Hybrid PDF text extractor
async function extractPdfText(arrayBuffer: ArrayBuffer) {
  try {
    console.log("🔄 Extracting PDF text with hybrid parser...");
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
      if (text && /[a-zA-Z0-9]/.test(text)) {
        extractedText += text + " ";
      }
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

    // ✅ Clean final text
    extractedText = cleanExtractedText(extractedText);
    console.log(`📄 Hybrid extraction length: ${extractedText.length}`);

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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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
    } else if (contentType.includes("application/json")) {
      const body = await req.json();
      const { fileBase64, name, type, size, userId: uid } = body;
      if (!fileBase64 || !uid) {
        return new Response(JSON.stringify({ error: "fileBase64 and userId are required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = uid;
      fileName = name || "upload.txt";
      fileType = type || "application/octet-stream";
      fileSize = size || fileBase64.length;
      fileBuffer = Uint8Array.from(atob(fileBase64), (c) => c.charCodeAt(0)).buffer;
    } else {
      return new Response(JSON.stringify({ error: "Unsupported content type" }), {
        status: 415,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ✅ Upload to Supabase Storage
    await supabase.storage.from("documents").upload(
      `${userId}/${fileName}`,
      new Blob([fileBuffer], { type: fileType }),
      { upsert: true }
    );

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
    } else if (fileType.startsWith("text/")) {
      extractedText = cleanExtractedText(new TextDecoder().decode(fileBuffer));
      extractionMethod = "text-decoder";
      extractionConfidence = extractedText.length > 200 ? "high" : "medium";
    } else {
      extractedText = `[UNSUPPORTED] File type '${fileType}'`;
      extractionStatus = "unsupported";
    }

    // ✅ Insert into DB
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
    console.log(`✅ Document saved: ${document.id}, extracted length=${extractedText.length}`);

    // ✅ Trigger AI function
    const hasUsefulText = extractedText.length > 20 && extractionStatus !== "error";
    if (hasUsefulText) {
      await supabase.functions.invoke("process-document", {
        body: {
          documentId: document.id,
          extractedText: extractedText.slice(0, 120_000),
          meta: { fileName, fileType, extractionMethod, extractionStatus, extractionConfidence },
          instruction:
            "Summaries and answers must stay faithful to extracted text. Ignore formatting errors. If text is incomplete, say so clearly.",
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
