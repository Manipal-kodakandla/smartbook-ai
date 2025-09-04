import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.56.1";

// ✅ Use the ES5 legacy build of pdfjs-dist (safe in Deno/Edge)
import * as pdfjsLib from "https://esm.sh/pdfjs-dist@4.0.379/es5/build/pdf.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Extracts text from a PDF buffer using pdfjs-dist
 * Works in Supabase Edge (Deno) by disabling worker usage
 */
async function extractPdfTextFromBuffer(buf: ArrayBuffer): Promise<string> {
  try {
    const uint8 = new Uint8Array(buf);
    const loadingTask = pdfjsLib.getDocument({
      data: uint8,
      disableWorker: true, // critical in Edge runtime
    });
    const pdf = await loadingTask.promise;
    let text = "";

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item: any) => ("str" in item ? item.str : ""))
        .join(" ");
      text += pageText + "\n\n";
    }

    return text.trim();
  } catch (err) {
    console.error("PDF.js extraction failed:", err);
    return "";
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Upload request received, method:", req.method);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const userId = formData.get("userId") as string;

    console.log("File:", file?.name, "Size:", file?.size, "Type:", file?.type);
    console.log("User ID:", userId);

    if (!file || !userId) {
      return new Response(
        JSON.stringify({ error: "File and userId are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const fileBuffer = await file.arrayBuffer();
    const fileName = file.name;
    const fileType = file.type || "application/octet-stream";
    const fileSize = file.size;

    let extractedText = "";

    if (fileType === "text/plain") {
      extractedText = new TextDecoder().decode(fileBuffer).trim();
    } else if (fileType === "application/pdf") {
      console.log("PDF detected → extracting via pdfjs-dist (es5)...");
      extractedText = await extractPdfTextFromBuffer(fileBuffer);
      console.log("PDF extracted length:", extractedText.length);

      if (!extractedText || extractedText.length < 20) {
        extractedText =
          "[EMPTY_OR_IMAGE_PDF] No selectable text found. PDF may be scanned images. Add OCR later.";
        console.warn("PDF appears to be image-based or empty.");
      }
    } else if (fileType.startsWith("image/")) {
      extractedText =
        "[IMAGE_FILE] OCR not enabled in this build. Please upload a PDF/TXT or add OCR.";
    } else {
      extractedText = "[UNSUPPORTED_DOC] Unsupported file type.";
    }

    // Store document in DB
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
      }])
      .select()
      .single();

    if (docError) {
      console.error("Failed to store document:", docError);
      return new Response(
        JSON.stringify({ error: "Failed to store document: " + docError.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log("Document stored with id:", document.id);

    // Run AI processing only if meaningful text was extracted
    const hasUsefulText =
      extractedText &&
      !extractedText.startsWith("[EMPTY_OR_IMAGE_PDF]") &&
      !extractedText.startsWith("[UNSUPPORTED_DOC]") &&
      extractedText.length > 50;

    if (hasUsefulText) {
      try {
        const { error: fnError } = await supabase.functions.invoke(
          "process-document",
          {
            body: JSON.stringify({
              documentId: document.id,
              extractedText: extractedText.slice(0, 120_000), // safety limit
            }),
          },
        );
        if (fnError) console.error("process-document invoke error:", fnError);
      } catch (e) {
        console.error("process-document call failed:", e);
      }
    } else {
      console.warn("Skipping AI processing due to missing/poor text.");
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
        message: hasUsefulText
          ? "Document uploaded. Processing started."
          : "Document uploaded but contained no extractable text; processing skipped.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("upload-document error:", error);
    return new Response(
      JSON.stringify({
        error: "Upload failed: " + (error?.message ?? String(error)),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
