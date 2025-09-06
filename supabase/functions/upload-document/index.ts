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

// ✅ Extract PDF text (simplified)
async function extractPdfText(arrayBuffer: ArrayBuffer) {
  try {
    const pdfDoc = await PDFDocument.load(arrayBuffer);
    const pageCount = pdfDoc.getPageCount();
    console.log(`✅ PDF loaded. Pages: ${pageCount}`);

    const pdfBytes = await pdfDoc.save();
    const pdfString = new TextDecoder("latin1").decode(pdfBytes);

    let extractedText = "";
    const textMatches = pdfString.match(/\((.*?)\)\s*Tj/g) || [];

    textMatches.forEach((match) => {
      const text = match.match(/\((.*?)\)/)?.[1];
      if (text && /[a-zA-Z0-9]/.test(text)) {
        extractedText += text + " ";
      }
    });

    extractedText = cleanExtractedText(extractedText);

    return {
      text: extractedText || "[PDF_LIB_MINIMAL] Minimal text found",
      method: "pdf-lib",
      status: extractedText.length > 20 ? "success" : "minimal_text",
      confidence: extractedText.length > 500 ? "high" : "medium",
    };
  } catch (err) {
    console.error("❌ PDF extraction failed:", err);
    return {
      text: "[PDF_LIB_ERROR] Extraction failed",
      method: "pdf-lib",
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

    // 🔍 Auto-detect content type
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      // ✅ Handle FormData upload
      const formData = await req.formData();
      const file = formData.get("file") as File;
      userId = formData.get("userId") as string;

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
      // ✅ Handle JSON base64 upload
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
    const { error: storageError } = await supabase.storage
      .from("documents")
      .upload(`${userId}/${fileName}`, new Blob([fileBuffer], { type: fileType }), {
        upsert: true,
      });

    if (storageError) {
      console.error("⚠️ Storage upload failed:", storageError);
    }

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

    // ✅ Trigger AI function if enough text
    console.log(
      `📊 Text analysis: length=${extractedText.length}, status=${extractionStatus}`
    );

    // ⚡ Option A: Loosen the "useful text" condition
    const hasUsefulText =
      extractedText.length > 20 && extractionStatus !== "error";

    console.log(`🔍 Has useful text: ${hasUsefulText}`);

    if (hasUsefulText) {
      console.log("🤖 Invoking AI processing...");
      try {
        console.log("📤 Calling process-document function with documentId:", document.id);
        const { data: processResult, error: processError } =
          await supabase.functions.invoke("process-document", {
            body: {
              documentId: document.id,
              extractedText: extractedText.slice(0, 120_000),
              meta: {
                fileName,
                fileType,
                extractionMethod,
                extractionStatus,
                extractionConfidence,
              },
              instruction:
                "Summaries and answers must stay faithful to extracted text. Ignore formatting errors. If text is incomplete, say so clearly.",
            },
          });

        if (processError) {
          console.error("❌ Process document function error:", processError);
          await supabase
            .from("documents")
            .update({
              processing_status: "failed",
              processed_at: new Date().toISOString(),
            })
            .eq("id", document.id);
        } else {
          console.log("✅ Process document function succeeded:", processResult);
        }
      } catch (error) {
        console.error("❌ Failed to invoke process-document function:", error);
        await supabase
          .from("documents")
          .update({
            processing_status: "failed",
            processed_at: new Date().toISOString(),
          })
          .eq("id", document.id);
      }
    } else {
      console.log("⏭️ Skipping AI processing - insufficient useful text");
      await supabase
        .from("documents")
        .update({
          processing_status: "completed",
          processed_at: new Date().toISOString(),
        })
        .eq("id", document.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        document,
        extraction: {
          status: extractionStatus,
          method: extractionMethod,
          confidence: extractionConfidence,
        },
        message: hasUsefulText
          ? `✅ Extracted with ${extractionMethod} (confidence: ${extractionConfidence}). AI started.`
          : `📄 Uploaded but insufficient text (status: ${extractionStatus}).`,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("💥 Global error:", error);
    return new Response(JSON.stringify({ error: error.message || String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
