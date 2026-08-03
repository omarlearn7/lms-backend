-- Migration 17: Grade-gating for content in RLS
-- Run this in Supabase SQL Editor.
--
-- Students can only SELECT content for their own grade level. Staff see
-- everything. Users without a grade level (or with an unknown grade code) are
-- NOT restricted, to avoid accidentally locking anyone out.
--
-- Mapping mirrors lms-backend GRADE_LABELS (lessons.grade_level stores Arabic
-- labels; profiles/units store codes).

-- 1. Helpers (SECURITY DEFINER so they bypass RLS -> no recursion)
CREATE OR REPLACE FUNCTION public.user_grade()
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT grade_level FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.grade_label(code text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE code
    WHEN 'grade_1' THEN 'سنة أولى ثانوي'
    WHEN 'grade_2' THEN 'سنة ثانية ثانوي'
    WHEN 'grade_3' THEN 'سنة ثالثة ثانوي'
    WHEN 'grade_4' THEN 'سنة رابعة متوسط'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.unit_grade(unit_id int)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT grade_level FROM public.units WHERE id = unit_id;
$$;

-- 2. Grade-gated SELECT policies.
--    Condition (shared):
--      has_access AND ( staff OR unknown user grade OR unmapped grade OR content-grade matches )
DROP POLICY IF EXISTS "lessons_select" ON public.lessons;
CREATE POLICY "lessons_select" ON public.lessons
  FOR SELECT
  USING (
    public.has_access(auth.uid())
    AND (
      public.is_staff(auth.uid())
      OR public.user_grade() IS NULL
      OR public.grade_label(public.user_grade()) IS NULL
      OR lessons.grade_level IS NULL
      OR lessons.grade_level = public.grade_label(public.user_grade())
    )
  );

DROP POLICY IF EXISTS "units_select" ON public.units;
CREATE POLICY "units_select" ON public.units
  FOR SELECT
  USING (
    public.has_access(auth.uid())
    AND (
      public.is_staff(auth.uid())
      OR public.user_grade() IS NULL
      OR public.grade_label(public.user_grade()) IS NULL
      OR units.grade_level IS NULL
      OR units.grade_level = public.user_grade()
    )
  );

DROP POLICY IF EXISTS "exercises_select" ON public.exercises;
CREATE POLICY "exercises_select" ON public.exercises
  FOR SELECT
  USING (
    public.has_access(auth.uid())
    AND (
      public.is_staff(auth.uid())
      OR public.user_grade() IS NULL
      OR public.grade_label(public.user_grade()) IS NULL
      OR public.unit_grade(unit_id) IS NULL
      OR public.unit_grade(unit_id) = public.user_grade()
    )
  );

-- quizzes have no grade column; keep access-gated only.
DROP POLICY IF EXISTS "quizzes_select" ON public.quizzes;
CREATE POLICY "quizzes_select" ON public.quizzes
  FOR SELECT USING (public.has_access(auth.uid()));
