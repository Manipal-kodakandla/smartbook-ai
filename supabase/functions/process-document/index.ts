
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
    const body = await req.text();
    let parsedBody;
    
    try {
      parsedBody = JSON.parse(body);
    } catch (parseError) {
      console.error('JSON parse error:', parseError, 'Body:', body);
      return new Response(
        JSON.stringify({ error: 'Invalid JSON in request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const { documentId, extractedText } = parsedBody;

    if (!documentId || !extractedText) {
      return new Response(
        JSON.stringify({ error: 'documentId and extractedText are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({ error: 'Gemini API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Processing document:', documentId);

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Call Gemini to analyze the text and create topics
    let aiContent = '';
    
    try {
      console.log('Calling Gemini for topic analysis...');
      const prompt = `You are an educational AI that breaks down academic content into digestible topics. 
              Analyze the provided text and create 3-5 main topics with the following structure:
              
              For each topic, provide:
              1. A clear title (max 50 characters)
              2. Main content explanation (2-3 sentences)
              3. A simplified explanation suitable for students
              4. A real-world example or analogy
              5. 3-5 key terms/keywords
              
              Return the result as a JSON array where each topic has: title, content, simplified_explanation, real_world_example, keywords (array of strings).

              Please analyze this text and break it into educational topics:

              ${extractedText.substring(0, 8000)}`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${geminiApiKey}`, {
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
      aiContent = aiResponse.candidates[0].content.parts[0].text;
      console.log('Gemini response received:', aiContent.length, 'characters');
    } catch (geminiError) {
      console.error('Gemini API failed:', geminiError);
      return new Response(
        JSON.stringify({ error: 'Failed to process document with AI: ' + geminiError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse the AI response
    let topics;
    try {
      topics = JSON.parse(aiContent);
      console.log('Parsed topics:', topics.length);
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      // Fallback topics if AI response is malformed
      topics = [
        {
          title: "Main Concepts",
          content: "Key concepts from the uploaded document.",
          simplified_explanation: "The main ideas and principles covered in your notes.",
          real_world_example: "These concepts apply to real-world scenarios and practical applications.",
          keywords: ["concepts", "principles", "ideas"]
        }
      ];
    }

    // Store topics in database
    const topicsWithDocId = topics.map((topic: any, index: number) => ({
      document_id: documentId,
      title: topic.title || `Topic ${index + 1}`,
      content: topic.content || 'Content not available',
      simplified_explanation: topic.simplified_explanation || 'Simplified explanation not available',
      real_world_example: topic.real_world_example || 'Example not available',
      keywords: Array.isArray(topic.keywords) ? topic.keywords : ['general'],
      topic_order: index
    }));

    const { data: storedTopics, error: topicsError } = await supabaseClient
      .from('topics')
      .insert(topicsWithDocId)
      .select();

    if (topicsError) {
      console.error('Error storing topics:', topicsError);
      throw new Error('Failed to store topics');
    }

    console.log('Topics stored successfully:', storedTopics.length);

    // Generate quizzes for each topic
    for (const topic of storedTopics) {
      try {
        console.log('Generating quiz for topic:', topic.title);
        const quizPrompt = `Create a multiple-choice quiz question based on the given topic. 
                Return a JSON object with: question (string), options (array of 4 strings), correct_answer (0-3 index), explanation (string).

                Create a quiz question for this topic:
                Title: ${topic.title}
                Content: ${topic.content}`;

        const quizResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${geminiApiKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: quizPrompt
              }]
            }]
          }),
        });

        if (quizResponse.ok) {
          const quizData = await quizResponse.json();
          const quizContent = quizData.candidates[0].content.parts[0].text;
          
          try {
            const quiz = JSON.parse(quizContent);
            
            await supabaseClient
              .from('quizzes')
              .insert([
                {
                  topic_id: topic.id,
                  question: quiz.question || 'Question not available',
                  options: Array.isArray(quiz.options) ? quiz.options : ['Option A', 'Option B', 'Option C', 'Option D'],
                  correct_answer: typeof quiz.correct_answer === 'number' ? quiz.correct_answer : 0,
                  explanation: quiz.explanation || 'Explanation not available'
                }
              ]);
            console.log('Quiz created for topic:', topic.title);
          } catch (error) {
            console.error('Failed to parse quiz JSON for topic:', topic.id, error);
          }
        } else {
          console.error('Quiz generation failed for topic:', topic.id);
        }
      } catch (error) {
        console.error('Failed to create quiz for topic:', topic.id, error);
      }
    }

    // Update document status
    await supabaseClient
      .from('documents')
      .update({ processing_status: 'completed', processed_at: new Date().toISOString() })
      .eq('id', documentId);

    console.log('Document processing completed successfully');

    return new Response(
      JSON.stringify({ 
        success: true, 
        topics: storedTopics,
        message: 'Document processed successfully'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in process-document function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
