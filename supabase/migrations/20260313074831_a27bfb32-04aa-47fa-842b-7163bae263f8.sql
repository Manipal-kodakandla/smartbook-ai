
-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_topics_document_id ON public.topics(document_id);
CREATE INDEX IF NOT EXISTS idx_quizzes_topic_id ON public.quizzes(topic_id);
CREATE INDEX IF NOT EXISTS idx_documents_processing_status ON public.documents(processing_status);
CREATE INDEX IF NOT EXISTS idx_topics_order ON public.topics(document_id, topic_order);
