import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const openAIApiKey = Deno.env.get('OPENAI_API_KEY');

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
      `Document: ${doc.title}\nContent: ${doc.extracted_text}`
    ).join('\n\n---\n\n');

    // Call OpenAI to answer the question based on the documents
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a helpful educational assistant. Answer questions based ONLY on the provided document content. 
            If the answer cannot be found in the documents, say so clearly. 
            Always cite which document(s) you're referencing in your answer.
            Keep answers concise but comprehensive.`
          },
          {
            role: 'user',
            content: `Based on these documents:\n\n${contextContent}\n\nQuestion: ${question}`
          }
        ],
        temperature: 0.3,
        max_tokens: 800
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('OpenAI API error:', errorData);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const aiResponse = await response.json();
    const answer = aiResponse.choices[0].message.content;

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
        sessionId: chatSession?.id
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