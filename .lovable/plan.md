

## Plan: Recreate Database Schema for New Supabase Project

Your new Supabase project is empty — no tables exist. The code expects 4 tables: `documents`, `topics`, `quizzes`, and `user_progress`. Additionally, a `documents` storage bucket is needed.

### Database Migration

Create all 4 tables with proper columns, types, and RLS policies:

**1. `documents` table**
- `id` (uuid, PK, default gen_random_uuid)
- `user_id` (text, not null)
- `title` (text)
- `file_name` (text)
- `file_type` (text)
- `file_size` (integer)
- `extracted_text` (text, default '')
- `processing_status` (text, default 'pending')
- `extraction_status` (text)
- `extraction_confidence` (text)
- `uploaded_at` (timestamptz, default now)
- `processed_at` (timestamptz)
- `created_at` (timestamptz, default now)

**2. `topics` table**
- `id` (uuid, PK, default gen_random_uuid)
- `document_id` (uuid, FK → documents.id on delete cascade)
- `title` (text)
- `content` (text)
- `simplified_explanation` (text)
- `real_world_example` (text)
- `keywords` (jsonb, default '[]')
- `topic_order` (integer, default 0)

**3. `quizzes` table**
- `id` (uuid, PK, default gen_random_uuid)
- `topic_id` (uuid, FK → topics.id on delete cascade)
- `question` (text)
- `options` (jsonb)
- `correct_answer` (integer)
- `explanation` (text, default '')

**4. `user_progress` table**
- `id` (uuid, PK, default gen_random_uuid)
- `user_id` (text, not null)
- `topic_id` (uuid, FK → topics.id on delete cascade)
- `completed` (boolean, default false)
- `quiz_score` (integer, default 0)
- `quiz_attempts` (integer, default 0)
- `last_accessed` (timestamptz, default now)
- Unique constraint on (user_id, topic_id)

### RLS Policies
- All tables get RLS enabled
- Since the app uses anonymous auth, policies allow authenticated users to read/write their own data (matching `user_id`) and service role full access
- `topics` and `quizzes` are readable by authenticated users (they're accessed via document ownership)

### Storage
- Create a `documents` storage bucket for file uploads

### Secrets
- Verify `GEMINI_API_KEY` is set in the new project's edge function secrets (it's not listed in current secrets)

### No Code Changes Needed
The existing code in `documentService.ts` will work once the tables exist and the types file auto-regenerates.

