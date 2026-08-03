-- Migration 20: Fix strip_answers array flattening
-- Run this in Supabase SQL Editor.
--
-- The original strip_answers appended each element with `res || elem`, and
-- jsonb array concatenation FLATTENS nested arrays. That corrupted any
-- content with arrays-of-arrays (e.g. table block `rows: [[...],[...]]`) when
-- served to non-staff via get_exercise_content. Wrap each result in
-- jsonb_build_array(...) so nesting is preserved.
--
-- Only affects the read-time function; stored content_json is untouched.

CREATE OR REPLACE FUNCTION public.strip_answers(v jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  res jsonb;
  pair record;
  elem jsonb;
BEGIN
  IF jsonb_typeof(v) = 'object' THEN
    IF v->>'type' = 'question'
       AND COALESCE(v->>'input_type', '') NOT IN ('progress_table', 'table')
    THEN
      RETURN v - 'answer' - 'solution';
    END IF;
    res := '{}'::jsonb;
    FOR pair IN SELECT * FROM jsonb_each(v)
    LOOP
      res := res || jsonb_build_object(pair.key, public.strip_answers(pair.value));
    END LOOP;
    RETURN res;
  ELSIF jsonb_typeof(v) = 'array' THEN
    res := '[]'::jsonb;
    FOR elem IN SELECT * FROM jsonb_array_elements(v)
    LOOP
      res := res || jsonb_build_array(public.strip_answers(elem));
    END LOOP;
    RETURN res;
  ELSE
    RETURN v;
  END IF;
END $$;
