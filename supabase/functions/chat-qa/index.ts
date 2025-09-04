import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.56.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { question, userId, documentId } = await req.json();
    if (!question || !userId) {
      return new Response(
        JSON.stringify({ error: "question and userId are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Gemini API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Fetch completed documents for this user (optionally one doc)
    let q = supabase
      .from("documents")
      .select("id,title,extracted_text")
      .eq("user_id", userId)
      .eq("processing_status", "completed");

    if (documentId) q = q.eq("id", documentId);

    const { data: documents, error: docErr } = await q;
    if (docErr) {
      console.error("Fetch documents error:", docErr);
      return new Response(
        JSON.stringify({ error: "Failed to fetch documents" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!documents || documents.length === 0) {
      return new Response(
        JSON.stringify({
          answer:
            "I don't have any processed documents to answer from. Please upload and process notes first.",
          sources: [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Build bounded context (avoid giant prompts)
    // Use up to 20k chars per doc, and 80k total
    let total = 0;
    const MAX_TOTAL = 80_000;
    const perDocLimit = 20_000;

    const snippets: string[] = [];
    const sourceTitles: string[] = [];

    for (const d of documents) {
      const text = String(d.extracted_text || "");
      const slice = text.slice(0, perDocLimit);
      if (slice.trim().length === 0) continue;

      const block = `TITLE: ${d.title}\nNOTES:\n${slice}`;
      if (total + block.length <= MAX_TOTAL) {
        snippets.push(block);
        sourceTitles.push(d.title);
        total += block.length;
      }
    }

    if (snippets.length === 0) {
      return new Response(
        JSON.stringify({
          answer:
            "Your uploaded notes contain no readable text. Please upload a PDF with selectable text or a TXT file.",
          sources: [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const context = snippets.join("\n\n---\n\n");

    const prompt = `
You are a notes-bound tutor. Answer ONLY from the notes below.
If the notes don't answer, reply exactly: "Your uploaded notes do not explain this topic."

NOTES:
${context}

QUESTION: ${question}

Answer from the notes only. If useful, quote short lines from the notes and mention the note title.
`.trim();

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          // Free-form text is fine here
        }),
      },
    );

    if (!resp.ok) {
      const t = await resp.text();
      console.error("Gemini Q&A error:", resp.status, t);
      throw new Error(`Gemini API error ${resp.status}`);
    }

    const data = await resp.json();
    const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text ??
      "Your uploaded notes do not explain this topic.";

    // (Optional) save chat history if you have a session concept
    // Skipping creation logic here for simplicity; restore yours as needed.

    return new Response(
      JSON.stringify({
        answer,
        sources: sourceTitles,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("chat-qa error:", error);
    return new Response(
      JSON.stringify({ error: error?.message ?? String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
