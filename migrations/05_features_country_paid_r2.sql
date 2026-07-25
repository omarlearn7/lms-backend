-- Migration 05: Add country, is_paid, and recorded_sessions table

-- 1. Add country column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country VARCHAR(100) DEFAULT NULL;

-- 2. Add is_paid column to courses (true = paid course, false = free)
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS is_paid BOOLEAN DEFAULT false;

-- 3. Add subject column to courses if missing
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS subject VARCHAR(255) DEFAULT NULL;

-- 4. Add image_url column to courses if missing
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT NULL;

-- 5. Add videos_count column to courses if missing
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS videos_count INT DEFAULT 0;

-- 6. Create recorded_sessions table for R2 uploaded recordings
CREATE TABLE IF NOT EXISTS public.recorded_sessions (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT DEFAULT NULL,
    course_id INT REFERENCES public.courses(id) ON DELETE SET NULL,
    uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    grade_level VARCHAR(50) DEFAULT NULL,
    r2_key VARCHAR(500) NOT NULL,
    r2_bucket VARCHAR(255) DEFAULT 'paid-course-streams',
    hls_manifest_key VARCHAR(500) DEFAULT NULL,
    duration_seconds INT DEFAULT 0,
    file_size_bytes BIGINT DEFAULT 0,
    thumbnail_url TEXT DEFAULT NULL,
    is_free BOOLEAN DEFAULT false,
    view_count INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 7. Enable RLS on recorded_sessions
ALTER TABLE public.recorded_sessions ENABLE ROW LEVEL SECURITY;

-- 8. RLS policies: subscribers, teachers, and admins can view
CREATE POLICY "Recorded sessions viewable by subscribers or staff"
  ON public.recorded_sessions FOR SELECT
  USING (
    is_free = true
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND (subscription_active = true OR role IN ('admin', 'teacher'))
    )
  );

-- 9. Teachers and admins can insert
CREATE POLICY "Teachers and admins can upload recorded sessions"
  ON public.recorded_sessions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'teacher')
    )
  );

-- 10. Teachers and admins can delete (for FIFO management)
CREATE POLICY "Teachers and admins can delete recorded sessions"
  ON public.recorded_sessions FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'teacher')
    )
  );

-- 11. Update videos schema: add is_free and duration_minutes if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'videos' AND column_name = 'is_free') THEN
    ALTER TABLE public.videos ADD COLUMN is_free BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'videos' AND column_name = 'duration_minutes') THEN
    ALTER TABLE public.videos ADD COLUMN duration_minutes INT DEFAULT 15;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'videos' AND column_name = 'youtube_id') THEN
    ALTER TABLE public.videos ADD COLUMN youtube_id VARCHAR(255) DEFAULT NULL;
  END IF;
END $$;

-- 12. Add subscription-related columns if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'subscription_expires_at') THEN
    ALTER TABLE public.profiles ADD COLUMN subscription_expires_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
  END IF;
END $$;

-- 13. Create categories table alias (if using a different name)
CREATE TABLE IF NOT EXISTS public.categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);
