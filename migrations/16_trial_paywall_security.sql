-- Migration 16: Free-trial + paywall, and RLS security hardening
-- Run this in Supabase SQL Editor.
--
-- Highlights:
--   * profiles.trial_ends_at (7-day trial for new signups; backfilled for existing)
--   * has_access(uid) helper: staff OR trial OR paid (user_access)
--   * Fixes critical RLS issues:
--       - anonymous PII read of profiles (was USING(true))
--       - privilege escalation (INSERT/UPDATE could set role='admin' / subscription_active)
--   * RLS for sessions / subscription_plans / course_categories (were unprotected)
--   * Content gated behind has_access (lessons, exercises, units, quizzes, recorded_sessions)
--   * Telegram group invite links visible only to PAID users (not trial)

-- 1. profiles: add trial column
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

-- 2. profiles.id FK must cascade when an auth user is deleted (auto account cleanup)
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_id_fkey
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- 3. Auto-create profile on signup (now includes trial_ends_at)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, role, first_name, last_name, grade_level, phone, country, trial_ends_at)
  VALUES (
    NEW.id,
    CASE WHEN NEW.raw_user_meta_data->>'role' IN ('student', 'parent', 'teacher', 'admin')
         THEN NEW.raw_user_meta_data->>'role' ELSE 'student' END,
    NULLIF(NEW.raw_user_meta_data->>'first_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'last_name', ''),
    CASE WHEN NEW.raw_user_meta_data->>'grade_level' IN ('grade_1', 'grade_2', 'grade_3', 'grade_4')
         THEN NEW.raw_user_meta_data->>'grade_level' END,
    NULLIF(NEW.raw_user_meta_data->>'phone', ''),
    NULLIF(NEW.raw_user_meta_data->>'country', ''),
    NEW.created_at + interval '7 days'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 4. Helpers (SECURITY DEFINER so they bypass RLS internally -> no recursion)
CREATE OR REPLACE FUNCTION public.is_staff(uid uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND role IN ('admin', 'teacher'));
$$;

CREATE OR REPLACE FUNCTION public.has_access(uid uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.is_staff(uid)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND trial_ends_at > now())
    OR EXISTS (
      SELECT 1 FROM public.user_access
      WHERE user_id = uid AND is_active = true
        AND (expires_at IS NULL OR expires_at > now())
    );
$$;

CREATE OR REPLACE FUNCTION public.is_paid(uid uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_access
    WHERE user_id = uid AND is_active = true
      AND (expires_at IS NULL OR expires_at > now())
  );
$$;

-- 5. profiles RLS: kill anon PII read + escalation
DROP POLICY IF EXISTS "Public profiles are viewable by everyone." ON public.profiles;
DROP POLICY IF EXISTS "Parents can view linked children profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile." ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile." ON public.profiles;

CREATE POLICY "profiles_select_own_staff_parent" ON public.profiles
  FOR SELECT
  USING (auth.uid() = id OR parent_id = auth.uid() OR public.is_staff(auth.uid()));

CREATE POLICY "profiles_insert_self" ON public.profiles
  FOR INSERT
  WITH CHECK (
    auth.uid() = id
    AND COALESCE(role, 'student') IN ('student', 'parent', 'teacher')
    AND subscription_active IS NOT TRUE
  );

CREATE POLICY "profiles_update_self" ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id OR public.is_staff(auth.uid()))
  WITH CHECK (
    (auth.uid() = id AND COALESCE(role, 'student') IN ('student', 'parent', 'teacher') AND subscription_active IS NOT TRUE)
    OR public.is_staff(auth.uid())
  );

-- 6. RLS for previously unprotected tables
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sessions_select_access" ON public.sessions;
CREATE POLICY "sessions_select_access" ON public.sessions
  FOR SELECT USING (public.has_access(auth.uid()));

DROP POLICY IF EXISTS "sessions_manage_staff" ON public.sessions;
CREATE POLICY "sessions_manage_staff" ON public.sessions
  FOR ALL USING (public.is_staff(auth.uid()));

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plans_select_auth" ON public.subscription_plans;
CREATE POLICY "plans_select_auth" ON public.subscription_plans
  FOR SELECT USING (auth.uid() IS NOT NULL);

ALTER TABLE public.course_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cc_select_auth" ON public.course_categories;
CREATE POLICY "cc_select_auth" ON public.course_categories
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- 7. Content gated behind has_access (lock everything once trial/paid ends)
DROP POLICY IF EXISTS "lessons_select" ON lessons;
CREATE POLICY "lessons_select" ON lessons
  FOR SELECT USING (public.has_access(auth.uid()));

DROP POLICY IF EXISTS "exercises_select" ON exercises;
CREATE POLICY "exercises_select" ON exercises
  FOR SELECT USING (public.has_access(auth.uid()));

DROP POLICY IF EXISTS "units_select" ON units;
CREATE POLICY "units_select" ON units
  FOR SELECT USING (public.has_access(auth.uid()));

DROP POLICY IF EXISTS "quizzes_select" ON quizzes;
CREATE POLICY "quizzes_select" ON quizzes
  FOR SELECT USING (public.has_access(auth.uid()));

DROP POLICY IF EXISTS "Recorded sessions viewable by subscribers or staff" ON public.recorded_sessions;
CREATE POLICY "recorded_sessions_select_access" ON public.recorded_sessions
  FOR SELECT USING (public.has_access(auth.uid()));

-- 8. Telegram invite links: PAID users + staff only (trial does NOT unlock these)
DROP POLICY IF EXISTS "Active telegram groups visible to everyone" ON public.telegram_groups;
CREATE POLICY "telegram_groups_select_paid" ON public.telegram_groups
  FOR SELECT USING (public.is_staff(auth.uid()) OR public.is_paid(auth.uid()));

-- 9. Backfill trial_ends_at for existing non-staff users (trial = signup + 7 days)
UPDATE public.profiles
SET trial_ends_at = created_at + interval '7 days'
WHERE trial_ends_at IS NULL
  AND (role IS NULL OR role NOT IN ('admin', 'teacher'));
