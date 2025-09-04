import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.56.1";

// Use the legacy ESM build that works in Deno without Node fs.
// We also disable the worker to avoid the workerSrc error in edge runtime.
import * as pdfjsLib from "https://esm.sh/pdfjs-dist@4.0.379/legacy/build/pdf.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function extractPdfTextFromBuffer(buf: ArrayBuffer): Promise<string> {
  try {
    const uint8 = new Uint8Array(buf);
    const loadingTask = pdfjsLib.getDocument({
      data: uint8,
      // Critical for Supabase Edge/Deno: avoid worker requirement
      disableWorker: true,
    } as any);

    const pdf = await loadingTask.promise;
    const numPages = pdf.numPages;

    let text = "";
    for (let p = 1; p <= numPages; p++) {
      const page = await pdf.getPage(p);
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
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Upload request received, method:", req.method);
    console.log("Content-Type:", req.headers.get("content-type"));

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const userId = (formData.get("userId") as string) || "";

    console.log("File:", file?.name, "Size:", file?.size, "Type:", file?.type);
    console.log("User ID:", userId);

    if (!file || !userId) {
      return new Response(
        JSON.stringify({ error: "File and userId are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const fileBuffer = await file.arrayBuffer();
    const fileName = file.name;
    const fileType = file.type || "application/octet-stream";
    const fileSize = file.size;

    console.log("File buffer size:", fileBuffer.byteLength);

    // --- Extract text (supports PDF & plain text; images placeholder for OCR) ---
    let extractedText = "";
    if (fileType === "text/plain") {
      extractedText = new TextDecoder().decode(fileBuffer).trim();
      console.log("Extracted plain text:", extractedText.length);
    } else if (fileType === "application/pdf") {
      console.log("PDF detected → extracting via pdfjs-dist (no worker)...");
      extractedText = await extractPdfTextFromBuffer(fileBuffer);
      console.log("PDF extracted length:", extractedText.length);

      if (!extractedText || extractedText.length < 20) {
        extractedText =
          "[EMPTY_OR_IMAGE_PDF] No selectable text found. The PDF may be scanned images. Add OCR later.";
        console.warn("PDF appears to be image-based or empty.");
      }
    } else if (fileType.startsWith("image/")) {
      extractedText =
        "[IMAGE_FILE] OCR not enabled in this build. Please upload a PDF/TXT or add OCR.";
      console.log("Image uploaded (OCR placeholder).");
    } else {
      extractedText =
        "[UNSUPPORTED_DOC] This file type isn’t parsed here. Please upload PDF/TXT.";
      console.log("Unsupported doc type for server extraction.");
    }

    // Store metadata + extracted text
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
        },
      ])
      .select()
      .single();

    if (docError) {
      console.error("Failed to store document:", docError);
      return new Response(
        JSON.stringify({ error: "Failed to store document: " + docError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("Document stored with id:", document.id);

    // Trigger AI processing only if we have real text
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
              // Keep it bounded to avoid excessive tokens
              extractedText: extractedText.slice(0, 120_000),
            }),
          },
        );
        if (fnError) {
          console.error("process-document invoke error:", fnError);
        }
      } catch (e) {
        console.error("process-document call failed:", e);
      }
    } else {
      console.warn("Skipping AI processing due to missing/poor text.");
      await supabase
        .from("documents")
        .update({ processing_status: "completed", processed_at: new Date().toISOString() })
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
  } catch (error: any) {
    console.error("upload-document error:", error);
    return new Response(
      JSON.stringify({ error: "Upload failed: " + (error?.message ?? String(error)) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
