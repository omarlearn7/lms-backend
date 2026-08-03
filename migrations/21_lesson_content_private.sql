-- Migration 21: Private lesson content fetch (answers stripped for non-staff)
-- Run this in Supabase SQL Editor.
--
-- Mirrors public.get_exercise_content: enforces has_access + grade gating
-- (same condition as the lessons_select RLS policy) and strips answer/solution
-- from question blocks for non-staff. Staff receive full content_json.
--
-- lesson blocks currently rendered in the app do not read answers at runtime;
-- quiz blocks inside lessons remain client-side (see migration 18 notes).

CREATE OR REPLACE FUNCTION public.get_lesson_content(p_slug text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ls public.lessons%ROWTYPE;
  v_staff boolean;
  v_ug text;
BEGIN
  IF NOT public.has_access(auth.uid()) THEN RETURN NULL; END IF;

  SELECT * INTO ls FROM public.lessons WHERE slug = p_slug;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_ug := public.user_grade();
  IF NOT public.is_staff(auth.uid())
     AND v_ug IS NOT NULL
     AND public.grade_label(v_ug) IS NOT NULL
     AND ls.grade_level IS NOT NULL
     AND ls.grade_level <> public.grade_label(v_ug)
  THEN
    RETURN NULL;
  END IF;

  v_staff := public.is_staff(auth.uid());

  RETURN jsonb_build_object(
    'id', ls.id,
    'title', ls.title,
    'slug', ls.slug,
    'description', ls.description,
    'category_id', ls.category_id,
    'unit_id', ls.unit_id,
    'grade_level', ls.grade_level,
    'is_free', ls.is_free,
    'content_json', CASE WHEN v_staff THEN ls.content_json ELSE public.strip_answers(ls.content_json) END,
    'thumbnail_url', ls.thumbnail_url,
    'created_at', ls.created_at,
    'updated_at', ls.updated_at
  );
END $$;
