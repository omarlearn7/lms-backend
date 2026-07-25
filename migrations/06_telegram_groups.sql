-- Migration 06: Telegram groups management

-- 1. Create telegram_groups table
CREATE TABLE IF NOT EXISTS public.telegram_groups (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('student', 'teacher', 'parent', 'admin', 'all')),
    invite_link VARCHAR(500) NOT NULL,
    grade_level VARCHAR(50) DEFAULT NULL,
    description TEXT DEFAULT NULL,
    is_active BOOLEAN DEFAULT true,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 2. Enable RLS
ALTER TABLE public.telegram_groups ENABLE ROW LEVEL SECURITY;

-- 3. Anyone can read active groups
CREATE POLICY "Active telegram groups visible to everyone"
  ON public.telegram_groups FOR SELECT
  USING (is_active = true);

-- 4. Admins can do everything
CREATE POLICY "Admins can manage telegram groups"
  ON public.telegram_groups FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
