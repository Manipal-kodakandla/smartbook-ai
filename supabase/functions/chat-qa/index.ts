import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const geminiApiKey = Deno.env.get('GEMINI_API_KEY');

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { question, userId, documentId } = await req.json();

    if (!question || !userId) {
      return new Response(
        JSON.stringify({ error: 'question and userId are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Processing Q&A for user:', userId, 'question:', question);

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get user's documents and their content
    let documentsQuery = supabaseClient
      .from('documents')
      .select('id, title, extracted_text')
      .eq('user_id', userId)
      .eq('processing_status', 'completed');

    if (documentId) {
      documentsQuery = documentsQuery.eq('id', documentId);
    }

    const { data: documents, error: docError } = await documentsQuery;

    if (docError) {
      console.error('Error fetching documents:', docError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch documents' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!documents || documents.length === 0) {
      return new Response(
        JSON.stringify({ 
          answer: "I don't have any processed documents to answer questions from. Please upload and process some documents first.",
          sources: []
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Combine all document content for context
    const contextContent = documents.map(doc => 
      `Document Title: ${doc.title}\nNotes Content:\n${doc.extracted_text || 'No content extracted'}`
    ).join('\n\n---\n\n');
    
    console.log('Context content length:', contextContent.length);
    console.log('Context preview:', contextContent.substring(0, 300));

    // Use Gemini API to answer the question
    let answer = '';
    let apiUsed = 'gemini';
    
    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({ error: 'Gemini API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    try {
      // Call Gemini to answer the question based on the documents
      const prompt = `You are answering questions about study notes. Use ONLY the notes content provided below.

STRICT RULES:
- Answer based ONLY on the notes content below
- If the notes don't contain the answer, respond: "Your uploaded notes do not explain this topic."
- Do NOT use external knowledge or general information
- Quote relevant parts from the notes when possible
- Mention which document contains the information

STUDY NOTES:
${contextContent}

QUESTION: ${question}

Answer from the notes only:`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${geminiApiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: prompt
            }]
          }]
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Gemini API error: ${response.status} - ${errorText}`);
        throw new Error(`Gemini API error: ${response.status}`);
      }

      const aiResponse = await response.json();
      answer = aiResponse.candidates[0].content.parts[0].text;
    } catch (geminiError) {
      console.error('Gemini API failed:', geminiError);
      return new Response(
        JSON.stringify({ error: 'Failed to get answer from AI: ' + geminiError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine which documents were likely referenced
    const sources = documents.map(doc => doc.title);

    // Get or create chat session
    let chatSession;
    if (documentId) {
      const { data: existingSession } = await supabaseClient
        .from('chat_sessions')
        .select('id')
        .eq('user_id', userId)
        .eq('document_id', documentId)
        .single();

      if (existingSession) {
        chatSession = existingSession;
      } else {
        const { data: newSession, error: sessionError } = await supabaseClient
          .from('chat_sessions')
          .insert([{ user_id: userId, document_id: documentId }])
          .select()
          .single();
        
        if (sessionError) {
          console.error('Error creating chat session:', sessionError);
        }
        chatSession = newSession;
      }
    }

    // Store the conversation if we have a session
    if (chatSession) {
      await supabaseClient
        .from('chat_messages')
        .insert([
          { session_id: chatSession.id, role: 'user', content: question },
          { session_id: chatSession.id, role: 'assistant', content: answer, sources }
        ]);
    }

    console.log('Q&A response generated successfully');

    return new Response(
      JSON.stringify({ 
        answer,
        sources,
        sessionId: chatSession?.id,
        apiUsed
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in chat-qa function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});