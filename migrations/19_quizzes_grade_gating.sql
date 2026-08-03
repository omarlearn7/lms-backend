-- Migration 19: Grade-gate the quizzes table like exercises
-- Run this in Supabase SQL Editor.
--
-- quizzes carries a unit_id, so the same unit-level grade check used by
-- exercises applies. Students only see quizzes from their own grade level;
-- staff, users without a grade, and unknown grade codes are unrestricted
-- (mirrors 17_grade_gating_rls.sql).

DROP POLICY IF EXISTS "quizzes_select" ON public.quizzes;
CREATE POLICY "quizzes_select" ON public.quizzes
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
