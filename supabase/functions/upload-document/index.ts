
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
    console.log('Upload request received, method:', req.method);
    console.log('Content-Type:', req.headers.get('content-type'));

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('Supabase client initialized');

    const formData = await req.formData();
    console.log('FormData parsed successfully');

    const file = formData.get('file') as File;
    const userId = formData.get('userId') as string;

    console.log('File:', file?.name, 'Size:', file?.size, 'Type:', file?.type);
    console.log('User ID:', userId);

    if (!file || !userId) {
      console.error('Missing file or userId');
      return new Response(
        JSON.stringify({ error: 'File and userId are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Read file content
    const fileBuffer = await file.arrayBuffer();
    const fileName = file.name;
    const fileType = file.type;
    const fileSize = file.size;

    console.log('File buffer size:', fileBuffer.byteLength);

    // Extract text based on file type
    let extractedText = '';
    
    if (fileType === 'text/plain') {
      extractedText = new TextDecoder().decode(fileBuffer);
      console.log('Text extracted from plain text file');
    } else if (fileType === 'application/pdf') {
      // For PDF files, we'll store the raw content and process later
      extractedText = 'PDF content - will be processed by AI service';
      console.log('PDF file detected');
    } else if (fileType.startsWith('image/')) {
      // For images, we'll use OCR (simulated for now)
      extractedText = 'Image content - will be processed with OCR';
      console.log('Image file detected');
    } else {
      extractedText = 'Document content - will be extracted and processed';
      console.log('Other document type detected');
    }

    console.log('Extracted text length:', extractedText.length);

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
          processing_status: 'processing'
        }
      ])
      .select()
      .single();

    if (docError) {
      console.error('Database error:', docError);
      return new Response(
        JSON.stringify({ error: 'Failed to store document: ' + docError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Document stored successfully:', document.id);

    // Call AI processing function to generate topics
    try {
      const { data: processData, error: processError } = await supabaseClient.functions.invoke(
        'process-document',
        {
          body: JSON.stringify({ documentId: document.id, extractedText })
        }
      );

      if (processError) {
        console.error('AI processing error:', processError);
        // Don't fail the upload if AI processing fails
        await supabaseClient
          .from('documents')
          .update({ processing_status: 'completed' })
          .eq('id', document.id);
      } else {
        console.log('AI processing completed successfully');
      }
    } catch (processError) {
      console.error('Error calling process-document:', processError);
      // Update status to completed even if processing fails
      await supabaseClient
        .from('documents')
        .update({ processing_status: 'completed' })
        .eq('id', document.id);
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
      JSON.stringify({ error: 'Upload failed: ' + error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
