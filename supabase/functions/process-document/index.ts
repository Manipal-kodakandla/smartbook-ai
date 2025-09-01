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
    const { documentId, extractedText } = await req.json();

    if (!documentId || !extractedText) {
      return new Response(
        JSON.stringify({ error: 'documentId and extractedText are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Processing document:', documentId);

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Call AI to analyze the text and create topics (OpenAI first, then Ollama fallback)
    let aiContent = '';
    
    if (openAIApiKey) {
      try {
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
                content: `You are an educational AI that breaks down academic content into digestible topics. 
                Analyze the provided text and create 3-5 main topics with the following structure:
                
                For each topic, provide:
                1. A clear title (max 50 characters)
                2. Main content explanation (2-3 sentences)
                3. A simplified explanation suitable for students
                4. A real-world example or analogy
                5. 3-5 key terms/keywords
                
                Return the result as a JSON array where each topic has: title, content, simplified_explanation, real_world_example, keywords (array of strings).`
              },
              {
                role: 'user',
                content: `Please analyze this text and break it into educational topics:\n\n${extractedText}`
              }
            ],
            temperature: 0.7,
            max_tokens: 2000
          }),
        });

        if (!response.ok) {
          throw new Error(`OpenAI API error: ${response.status}`);
        }

        const aiResponse = await response.json();
        aiContent = aiResponse.choices[0].message.content;
      } catch (openaiError) {
        console.log('OpenAI failed, trying Ollama fallback:', openaiError);
        
        // Fallback to Ollama
        const ollamaResponse = await fetch('http://localhost:11434/api/generate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'llama3.2',
            prompt: `You are an educational AI that breaks down academic content into digestible topics. 
            Analyze the provided text and create 3-5 main topics with the following structure:
            
            For each topic, provide:
            1. A clear title (max 50 characters)
            2. Main content explanation (2-3 sentences)
            3. A simplified explanation suitable for students
            4. A real-world example or analogy
            5. 3-5 key terms/keywords
            
            Return the result as a JSON array where each topic has: title, content, simplified_explanation, real_world_example, keywords (array of strings).
            
            Please analyze this text and break it into educational topics:
            ${extractedText}`,
            stream: false,
          }),
        });

        if (!ollamaResponse.ok) {
          throw new Error(`Ollama API error: ${ollamaResponse.status}`);
        }

        const ollamaData = await ollamaResponse.json();
        aiContent = ollamaData.response;
      }
    } else {
      // No OpenAI key, use Ollama directly
      const ollamaResponse = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama3.2',
          prompt: `You are an educational AI that breaks down academic content into digestible topics. 
          Analyze the provided text and create 3-5 main topics with the following structure:
          
          For each topic, provide:
          1. A clear title (max 50 characters)
          2. Main content explanation (2-3 sentences)
          3. A simplified explanation suitable for students
          4. A real-world example or analogy
          5. 3-5 key terms/keywords
          
          Return the result as a JSON array where each topic has: title, content, simplified_explanation, real_world_example, keywords (array of strings).
          
          Please analyze this text and break it into educational topics:
          ${extractedText}`,
          stream: false,
        }),
      });

      if (!ollamaResponse.ok) {
        throw new Error(`Ollama API error: ${ollamaResponse.status}`);
      }

      const ollamaData = await ollamaResponse.json();
      aiContent = ollamaData.response;
    }

    console.log('AI response received:', aiContent.length, 'characters');

    // Parse the AI response
    let topics;
    try {
      topics = JSON.parse(aiContent);
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
      title: topic.title,
      content: topic.content,
      simplified_explanation: topic.simplified_explanation,
      real_world_example: topic.real_world_example,
      keywords: topic.keywords,
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
      let quizContent = '';
      
      if (openAIApiKey) {
        try {
          const quizResponse = await fetch('https://api.openai.com/v1/chat/completions', {
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
                  content: `Create a multiple-choice quiz question based on the given topic. 
                  Return a JSON object with: question (string), options (array of 4 strings), correct_answer (0-3 index), explanation (string).`
                },
                {
                  role: 'user',
                  content: `Create a quiz question for this topic:\nTitle: ${topic.title}\nContent: ${topic.content}`
                }
              ],
              temperature: 0.7,
              max_tokens: 500
            }),
          });

          if (quizResponse.ok) {
            const quizData = await quizResponse.json();
            quizContent = quizData.choices[0].message.content;
          } else {
            throw new Error('OpenAI quiz generation failed');
          }
        } catch (openaiError) {
          console.log('OpenAI quiz generation failed, trying Ollama:', openaiError);
          
          // Fallback to Ollama for quiz generation
          const ollamaQuizResponse = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'llama3.2',
              prompt: `Create a multiple-choice quiz question based on the given topic. 
              Return a JSON object with: question (string), options (array of 4 strings), correct_answer (0-3 index), explanation (string).
              
              Create a quiz question for this topic:
              Title: ${topic.title}
              Content: ${topic.content}`,
              stream: false,
            }),
          });
          
          if (ollamaQuizResponse.ok) {
            const ollamaQuizData = await ollamaQuizResponse.json();
            quizContent = ollamaQuizData.response;
          }
        }
      } else {
        // No OpenAI key, use Ollama directly
        const ollamaQuizResponse = await fetch('http://localhost:11434/api/generate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'llama3.2',
            prompt: `Create a multiple-choice quiz question based on the given topic. 
            Return a JSON object with: question (string), options (array of 4 strings), correct_answer (0-3 index), explanation (string).
            
            Create a quiz question for this topic:
            Title: ${topic.title}
            Content: ${topic.content}`,
            stream: false,
          }),
        });
        
        if (ollamaQuizResponse.ok) {
          const ollamaQuizData = await ollamaQuizResponse.json();
          quizContent = ollamaQuizData.response;
        }
      }

      // Parse and store quiz if we got content
      if (quizContent) {
        try {
          const quiz = JSON.parse(quizContent);
          
          await supabaseClient
            .from('quizzes')
            .insert([
              {
                topic_id: topic.id,
                question: quiz.question,
                options: quiz.options,
                correct_answer: quiz.correct_answer,
                explanation: quiz.explanation
              }
            ]);
        } catch (error) {
          console.error('Failed to create quiz for topic:', topic.id, error);
        }
      }
    }

    // Update document status
    await supabaseClient
      .from('documents')
      .update({ processing_status: 'completed', processed_at: new Date().toISOString() })
      .eq('id', documentId);

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