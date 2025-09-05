-- Add foreign key constraints and indexes for better data integrity and performance

-- Add foreign key constraint from topics.document_id to documents.id with cascade delete
ALTER TABLE public.topics 
ADD CONSTRAINT fk_topics_document_id 
FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;

-- Add foreign key constraint from quizzes.topic_id to topics.id with cascade delete  
ALTER TABLE public.quizzes
ADD CONSTRAINT fk_quizzes_topic_id
FOREIGN KEY (topic_id) REFERENCES public.topics(id) ON DELETE CASCADE;

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_topics_document_id ON public.topics(document_id);
CREATE INDEX IF NOT EXISTS idx_quizzes_topic_id ON public.quizzes(topic_id);

-- Add index on processing_status for faster filtering
CREATE INDEX IF NOT EXISTS idx_documents_processing_status ON public.documents(processing_status);

-- Add index on topic_order for proper ordering
CREATE INDEX IF NOT EXISTS idx_topics_order ON public.topics(document_id, topic_order);