
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
      console.log('ExtractedText preview:', extractedText.substring(0, 200));
      
      if (!extractedText || extractedText.trim().length < 10) {
        console.error('ExtractedText is too short or empty:', extractedText);
        throw new Error('Document content is too short to analyze');
      }

      const prompt = `You are analyzing study notes to create learning topics. Use ONLY the content provided below.

CRITICAL INSTRUCTIONS:
- Create topics based ONLY on what's written in these notes
- Do NOT mention PDFs, documents, file processing, or OCR
- Do NOT add general knowledge beyond what's in the notes
- If the notes are about a specific subject, focus on that subject's concepts

Analyze these study notes and break them into 3-5 learning topics:

For each topic, provide:
1. title: Brief topic name (max 50 chars) from the notes
2. content: What the notes say about this topic (2-3 sentences)
3. simplified_explanation: Easier way to understand this concept
4. real_world_example: Practical example related to this concept
5. keywords: Array of key terms from the notes

Return clean JSON array only - no markdown, no code fences.

STUDY NOTES CONTENT:
${extractedText}`;

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
        const quizPrompt = `Create a quiz question about this study topic. Base the question ONLY on the content provided.

Topic: ${topic.title}
Content: ${topic.content}
Simplified: ${topic.simplified_explanation}

Create ONE multiple-choice question that tests understanding of this specific topic.

Return clean JSON only:
{
  "question": "Question text here",
  "options": ["Option A", "Option B", "Option C", "Option D"],
  "correct_answer": 0,
  "explanation": "Why this answer is correct"
}

No markdown, no code fences, just the JSON object.`;

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
