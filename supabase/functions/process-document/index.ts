
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
              
              Return ONLY a clean JSON array where each topic has: title, content, simplified_explanation, real_world_example, keywords (array of strings).
              
              Do not include any markdown formatting, backticks, or extra text. Return only the JSON array.

              Please analyze this text and break it into educational topics:

              ${extractedText.substring(0, 8000)}`;

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
      aiContent = aiResponse.candidates[0].content.parts[0].text;
      console.log('Gemini response received:', aiContent.length, 'characters');
    } catch (geminiError) {
      console.error('Gemini API failed:', geminiError);
      return new Response(
        JSON.stringify({ error: 'Failed to process document with AI: ' + geminiError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse the AI response - sanitize and clean
    let topics;
    try {
      // Sanitize the AI response by removing markdown code fences and extra whitespace
      let cleanedContent = aiContent.trim();
      
      // Remove ```json and ``` markers if present
      if (cleanedContent.startsWith('```json')) {
        cleanedContent = cleanedContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanedContent.startsWith('```')) {
        cleanedContent = cleanedContent.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      
      topics = JSON.parse(cleanedContent);
      console.log('Parsed topics:', topics.length);
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      console.log('Raw AI content:', aiContent);
      
      // Try one more time with more aggressive cleaning
      try {
        let retryContent = aiContent.replace(/```json|```/g, '').trim();
        // Remove any text before the first [ or {
        const jsonStart = Math.min(
          retryContent.indexOf('[') >= 0 ? retryContent.indexOf('[') : Infinity,
          retryContent.indexOf('{') >= 0 ? retryContent.indexOf('{') : Infinity
        );
        if (jsonStart !== Infinity) {
          retryContent = retryContent.substring(jsonStart);
        }
        topics = JSON.parse(retryContent);
        console.log('Retry parse successful:', topics.length);
      } catch (retryError) {
        console.error('Retry parse also failed:', retryError);
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
                Return ONLY a clean JSON object with: question (string), options (array of 4 strings), correct_answer (0-3 index), explanation (string).
                
                Do not include any markdown formatting, backticks, or extra text. Return only the JSON object.

                Create a quiz question for this topic:
                Title: ${topic.title}
                Content: ${topic.content}`;

        const quizResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${geminiApiKey}`, {
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
            // Sanitize quiz content similar to topics
            let cleanedQuizContent = quizContent.trim();
            
            // Remove ```json and ``` markers if present
            if (cleanedQuizContent.startsWith('```json')) {
              cleanedQuizContent = cleanedQuizContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');
            } else if (cleanedQuizContent.startsWith('```')) {
              cleanedQuizContent = cleanedQuizContent.replace(/^```\s*/, '').replace(/\s*```$/, '');
            }
            
            const quiz = JSON.parse(cleanedQuizContent);
            
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
          } catch (parseError) {
            console.error('Failed to parse quiz JSON for topic:', topic.id, parseError);
            
            // Try one more time with aggressive cleaning
            try {
              let retryQuizContent = quizContent.replace(/```json|```/g, '').trim();
              const jsonStart = Math.min(
                retryQuizContent.indexOf('{') >= 0 ? retryQuizContent.indexOf('{') : Infinity
              );
              if (jsonStart !== Infinity) {
                retryQuizContent = retryQuizContent.substring(jsonStart);
              }
              
              const quiz = JSON.parse(retryQuizContent);
              
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
              console.log('Quiz created for topic (retry):', topic.title);
            } catch (retryError) {
              console.error('Quiz retry parse also failed for topic:', topic.id, retryError);
            }
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
