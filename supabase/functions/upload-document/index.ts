import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const formData = await req.formData();
    const file = formData.get('file') as File;
    const userId = formData.get('userId') as string;

    if (!file || !userId) {
      return new Response(
        JSON.stringify({ error: 'File and userId are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Processing file:', file.name, 'for user:', userId);

    // Read file content
    const fileBuffer = await file.arrayBuffer();
    const fileName = file.name;
    const fileType = file.type;
    const fileSize = file.size;

    // Extract text based on file type
    let extractedText = '';
    
    if (fileType === 'text/plain') {
      extractedText = new TextDecoder().decode(fileBuffer);
    } else if (fileType === 'application/pdf') {
      // For PDF files, we'll store the raw content and process later
      extractedText = 'PDF content extraction not implemented yet - will be processed by AI service';
    } else if (fileType.startsWith('image/')) {
      // For images, we'll use OCR (simulated for now)
      extractedText = 'Image OCR processing - will extract text from image';
    } else {
      extractedText = 'Document type supported - content will be extracted';
    }

    // Store document in database
    const { data: document, error: docError } = await supabaseClient
      .from('documents')
      .insert([
        {
          user_id: userId,
          title: fileName.replace(/\.[^/.]+$/, ''), // Remove file extension
          file_name: fileName,
          file_type: fileType,
          file_size: fileSize,
          extracted_text: extractedText,
          processing_status: 'completed'
        }
      ])
      .select()
      .single();

    if (docError) {
      console.error('Database error:', docError);
      return new Response(
        JSON.stringify({ error: 'Failed to store document' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Document stored successfully:', document.id);

    // Call AI processing function to generate topics
    const { data: processData, error: processError } = await supabaseClient.functions.invoke(
      'process-document',
      {
        body: { documentId: document.id, extractedText }
      }
    );

    if (processError) {
      console.error('AI processing error:', processError);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        document,
        message: 'Document uploaded and processing started'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in upload-document function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});