
-- 1. Documents table
CREATE TABLE public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  title text,
  file_name text,
  file_type text,
  file_size integer,
  extracted_text text DEFAULT '',
  processing_status text DEFAULT 'pending',
  extraction_status text,
  extraction_confidence text,
  uploaded_at timestamptz DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own documents" ON public.documents FOR SELECT USING (true);
CREATE POLICY "Users can insert documents" ON public.documents FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update own documents" ON public.documents FOR UPDATE USING (true);
CREATE POLICY "Users can delete own documents" ON public.documents FOR DELETE USING (true);

-- 2. Topics table
CREATE TABLE public.topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE,
  title text,
  content text,
  simplified_explanation text,
  real_world_example text,
  keywords jsonb DEFAULT '[]'::jsonb,
  topic_order integer DEFAULT 0
);

ALTER TABLE public.topics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view topics" ON public.topics FOR SELECT USING (true);
CREATE POLICY "Anyone can insert topics" ON public.topics FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update topics" ON public.topics FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete topics" ON public.topics FOR DELETE USING (true);

-- 3. Quizzes table
CREATE TABLE public.quizzes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid REFERENCES public.topics(id) ON DELETE CASCADE,
  question text,
  options jsonb,
  correct_answer integer,
  explanation text DEFAULT ''
);

ALTER TABLE public.quizzes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view quizzes" ON public.quizzes FOR SELECT USING (true);
CREATE POLICY "Anyone can insert quizzes" ON public.quizzes FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update quizzes" ON public.quizzes FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete quizzes" ON public.quizzes FOR DELETE USING (true);

-- 4. User progress table
CREATE TABLE public.user_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  topic_id uuid REFERENCES public.topics(id) ON DELETE CASCADE,
  completed boolean DEFAULT false,
  quiz_score integer DEFAULT 0,
  quiz_attempts integer DEFAULT 0,
  last_accessed timestamptz DEFAULT now(),
  UNIQUE(user_id, topic_id)
);

ALTER TABLE public.user_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own progress" ON public.user_progress FOR SELECT USING (true);
CREATE POLICY "Users can insert progress" ON public.user_progress FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update own progress" ON public.user_progress FOR UPDATE USING (true);

-- 5. Storage bucket for documents
INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', true);

CREATE POLICY "Anyone can upload documents" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'documents');
CREATE POLICY "Anyone can view documents" ON storage.objects FOR SELECT USING (bucket_id = 'documents');
CREATE POLICY "Anyone can delete documents" ON storage.objects FOR DELETE USING (bucket_id = 'documents');
