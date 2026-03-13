import { supabase } from "@/integrations/supabase/client";

export interface Document {
  id: string;
  title: string;
  file_name: string;
  file_type: string;
  file_size: number;
  user_id?: string;
  extracted_text: string;
  processing_status: 'pending' | 'processing' | 'completed' | 'failed';
  uploaded_at: string;
  processed_at?: string;
}

export interface Topic {
  id: string;
  document_id: string;
  title: string;
  content: string;
  simplified_explanation: string;
  real_world_example: string;
  keywords: string[];
  topic_order: number;
}

export interface Quiz {
  id: string;
  topic_id: string;
  question: string;
  options: string[];
  correct_answer: number;
  explanation: string;
}

export interface UserProgress {
  id: string;
  topic_id: string;
  completed: boolean;
  quiz_score: number;
  quiz_attempts: number;
  last_accessed: string;
}

export const documentService = {
  async uploadDocument(file: File, userId: string): Promise<Document> {
    console.log('Starting document upload for file:', file.name);
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('userId', userId);

    console.log('FormData prepared, calling supabase function...');

    try {
      console.log('🔄 Calling supabase function upload-document...');
      const { data, error } = await supabase.functions.invoke('upload-document', {
        body: formData,
      });

      console.log('📥 Supabase function response:', { data, error });

      if (error) {
        console.error('❌ Supabase function error:', error);
        throw new Error(error.message || 'Failed to upload document');
      }

      if (!data || !data.document) {
        console.error('❌ Invalid response structure:', data);
        throw new Error('Invalid response from upload function');
      }

      console.log('✅ Upload successful, document:', data.document);
      console.log('📊 Processing status:', data.document.processing_status);
      return data.document;
    } catch (error) {
      console.error('💥 Upload error in documentService:', error);
      throw error;
    }
  },

  async getUserDocuments(userId: string): Promise<Document[]> {
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('user_id', userId)
      .order('uploaded_at', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data || []).map(doc => ({
      ...doc,
      processing_status: doc.processing_status as 'pending' | 'processing' | 'completed' | 'failed'
    }));
  },

  async getDocumentTopics(documentId: string): Promise<Topic[]> {
    console.log('🔍 Fetching topics for document ID:', documentId);
    
    const { data, error } = await supabase
      .from('topics')
      .select('*')
      .eq('document_id', documentId)
      .order('topic_order', { ascending: true });

    console.log('📊 Topics query result:', { data, error, count: data?.length });

    if (error) {
      console.error('❌ Error fetching topics:', error);
      throw new Error(error.message);
    }

    console.log('✅ Retrieved topics:', data);
    return (data || []).map(t => ({ ...t, keywords: (t.keywords as string[] || []) }));
  },

  async getTopicQuizzes(topicId: string): Promise<Quiz[]> {
    const { data, error } = await supabase
      .from('quizzes')
      .select('*')
      .eq('topic_id', topicId);

    if (error) {
      throw new Error(error.message);
    }

    return (data || []).map(quiz => ({
      ...quiz,
      options: Array.isArray(quiz.options) ? quiz.options as string[] : [],
      explanation: quiz.explanation || ''
    }));
  },

  async getUserProgress(userId: string, topicId: string): Promise<UserProgress | null> {
    const { data, error } = await supabase
      .from('user_progress')
      .select('*')
      .eq('user_id', userId)
      .eq('topic_id', topicId)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    return data;
  },

  async updateUserProgress(
    userId: string, 
    topicId: string, 
    updates: Partial<UserProgress>
  ): Promise<UserProgress> {
    const { data, error } = await supabase
      .from('user_progress')
      .upsert([
        {
          user_id: userId,
          topic_id: topicId,
          ...updates,
          last_accessed: new Date().toISOString(),
        }
      ])
      .select()
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return data;
  },

  async askQuestion(question: string, userId: string, documentId?: string): Promise<{
    answer: string;
    sources: string[];
    sessionId: string;
  }> {
    const { data, error } = await supabase.functions.invoke('chat-qa', {
      body: { question, userId, documentId },
    });

    if (error) {
      throw new Error(error.message || 'Failed to get answer');
    }

    return data;
  },
};
