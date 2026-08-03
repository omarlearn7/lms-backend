-- Migration 18: Make exercise answers private (server-side grading)
-- Run this in Supabase SQL Editor.
--
-- Phase 1 (this file):
--   * exercises.answer_key (JSONB): answer per question block, aligned by
--     index with the frontend's filtered question order.
--   * get_exercise_content(exercise_id): returns an exercise with answers
--     stripped from content_json for non-staff; full content for staff.
--   * check_exercise(exercise_id, answers): grades server-side and returns
--     {"<idx>": "correct"|"wrong"}.
--
-- Documented limitation: progress_table question blocks (3 in the dataset)
-- keep their `answer` in content_json because the progress-table UI renders
-- per-cell feedback from it. All other input types (numeric, mcq, equation,
-- formula, text) are answer-free for students. Lesson quiz blocks remain
-- client-side.

-- 1. answer_key column
ALTER TABLE public.exercises ADD COLUMN IF NOT EXISTS answer_key JSONB;

-- 2. Extract the ordered per-question answer array from content_json.
--    Mirrors the frontend's `blocks.filter(b => b.type === 'question')`.
CREATE OR REPLACE FUNCTION public.extract_answer_key(cj jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  items jsonb;
  sec jsonb;
  blocks jsonb;
  b jsonb;
  key jsonb := '[]'::jsonb;
BEGIN
  IF cj IS NULL THEN RETURN '[]'::jsonb; END IF;
  items := COALESCE(cj->'sections', cj->'blocks', cj);
  IF jsonb_typeof(items) <> 'array' THEN RETURN '[]'::jsonb; END IF;
  FOR sec IN SELECT * FROM jsonb_array_elements(items)
  LOOP
    IF sec ? 'blocks' THEN
      blocks := sec->'blocks';
    ELSE
      blocks := jsonb_build_array(sec);
    END IF;
    FOR b IN SELECT * FROM jsonb_array_elements(blocks)
    LOOP
      IF b->>'type' = 'question' THEN
        key := key || jsonb_build_object(
          'input_type', b->>'input_type',
          'answer', b->'answer'
        );
      END IF;
    END LOOP;
  END LOOP;
  RETURN key;
END $$;

-- 3. answerable[] flag per question (aligned with question order)
CREATE OR REPLACE FUNCTION public.answerable_from_key(key jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(
    jsonb_agg(q->'answer' IS NOT NULL AND q->'answer' <> 'null'::jsonb ORDER BY ord),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(key) WITH ORDINALITY AS t(q, ord);
$$;

-- 4. Backfill answer_key
UPDATE public.exercises SET answer_key = public.extract_answer_key(content_json)
WHERE answer_key IS NULL;

-- 5. Recursively strip answers from content_json (keeps progress_table).
--    Strips keys named answer/solution inside question blocks; everything else
--    (including simulation html) is preserved.
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
      res := res || public.strip_answers(elem);
    END LOOP;
    RETURN res;
  ELSE
    RETURN v;
  END IF;
END $$;

-- 6. Fetch exercise content (answers stripped for non-staff).
CREATE OR REPLACE FUNCTION public.get_exercise_content(p_id int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ex public.exercises%ROWTYPE;
  v_key jsonb;
  v_staff boolean;
BEGIN
  IF NOT public.has_access(auth.uid()) THEN RETURN NULL; END IF;

  SELECT * INTO ex FROM public.exercises WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF NOT public.is_staff(auth.uid())
     AND public.user_grade() IS NOT NULL
     AND public.grade_label(public.user_grade()) IS NOT NULL
     AND public.unit_grade(ex.unit_id) IS NOT NULL
     AND public.unit_grade(ex.unit_id) <> public.user_grade()
  THEN
    RETURN NULL;
  END IF;

  v_staff := public.is_staff(auth.uid());
  v_key := ex.answer_key;
  IF v_key IS NULL THEN v_key := public.extract_answer_key(ex.content_json); END IF;

  RETURN jsonb_build_object(
    'id', ex.id,
    'unit_id', ex.unit_id,
    'title', ex.title,
    'source', ex.source,
    'order_index', ex.order_index,
    'pdf_url', ex.pdf_url,
    'content_json', CASE WHEN v_staff THEN ex.content_json ELSE public.strip_answers(ex.content_json) END,
    'answerable', public.answerable_from_key(v_key)
  );
END $$;

-- 7. Equation normalization (mirrors JS: replace(/\s+/g,' ').trim())
CREATE OR REPLACE FUNCTION public.norm_eq(s text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT btrim(regexp_replace(COALESCE(s, ''), '\s+', ' ', 'g'));
$$;

-- 8. Server-side grading. answers = {"<questionIndex>": "<user value>"}
--    Returns {"<questionIndex>": "correct"|"wrong"}.
--    Mirrors the grading in lms-frontend ExerciseBlock.checkAnswer.
CREATE OR REPLACE FUNCTION public.check_exercise(p_id int, p_answers jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  key jsonb;
  res jsonb := '{}'::jsonb;
  q jsonb;
  idx int := 0;
  ua text;
  it text;
  ans jsonb;
  ok boolean;
  graded boolean;
  uval numeric;
  aval numeric;
  tol numeric;
  n1 text;
  n2 text;
  acc jsonb;
  s text;
  ex public.exercises%ROWTYPE;
  qblock jsonb;
  species_arr jsonb;
  sp text;
  spci int;
  rk text;
  ri int;
  rowarr jsonb;
  exp text;
  actual text;
  okall boolean;
  userjson jsonb;
BEGIN
    IF NOT public.has_access(auth.uid()) THEN
      RAISE EXCEPTION 'check_exercise: access denied';
    END IF;
    SELECT answer_key INTO key FROM public.exercises WHERE id = p_id;
    IF key IS NULL THEN RETURN '{}'::jsonb; END IF;
    SELECT * INTO ex FROM public.exercises WHERE id = p_id;

    FOR q IN SELECT * FROM jsonb_array_elements(key)
    LOOP
      ua := p_answers->>(idx::text);
      ok := false;
      graded := false;
      IF (q ? 'answer') AND q->'answer' <> 'null'::jsonb
         AND ua IS NOT NULL AND btrim(ua) <> '' THEN
        graded := true;
        it := q->>'input_type';
        ans := q->'answer';
        IF it IN ('numeric', 'number') THEN
          IF jsonb_typeof(ans) = 'object' AND ans ? 'value' THEN
            BEGIN
              uval := ua::numeric;
              aval := (ans->>'value')::numeric;
              tol := COALESCE((ans->>'tolerance')::numeric, 0.01);
              ok := abs(uval - aval) <= tol;
            EXCEPTION WHEN others THEN ok := false; END;
          END IF;
        ELSIF it = 'mcq' THEN
          ok := (ans->>'value') = ua;
        ELSIF it IN ('equation', 'formula') THEN
          n1 := public.norm_eq(ua);
          IF jsonb_typeof(ans) = 'array' THEN acc := ans; ELSE acc := jsonb_build_array(ans); END IF;
          FOR s IN SELECT * FROM jsonb_array_elements_text(acc)
          LOOP
            n2 := public.norm_eq(s);
            IF n1 = n2 THEN ok := true; EXIT; END IF;
          END LOOP;
        ELSIF it = 'progress_table' THEN
          BEGIN
            userjson := ua::jsonb;
            qblock := public.question_block(ex.content_json, idx);
            IF qblock IS NOT NULL THEN
              species_arr := qblock->'species';
              IF species_arr IS NULL THEN
                species_arr := public.parse_species(qblock->>'reaction');
              END IF;
              IF jsonb_typeof(userjson) = 'array'
                 AND jsonb_array_length(userjson) >= 3
                 AND jsonb_typeof(species_arr) = 'array' THEN
                okall := true;
                spci := 0;
                FOR sp IN SELECT * FROM jsonb_array_elements_text(species_arr)
                LOOP
                  ri := 0;
                  FOR rk IN SELECT * FROM jsonb_array_elements_text(jsonb_build_array('initial','during','final'))
                  LOOP
                    rowarr := CASE rk WHEN 'initial' THEN userjson->0 WHEN 'during' THEN userjson->1 ELSE userjson->2 END;
                    exp := COALESCE(ans->'cells'->sp->>rk, '');
                    actual := COALESCE(rowarr->>spci, '');
                    IF public.norm_eq(actual) <> public.norm_eq(exp) THEN okall := false; END IF;
                    ri := ri + 1;
                  END LOOP;
                  spci := spci + 1;
                END LOOP;
                ok := okall;
              END IF;
            END IF;
          EXCEPTION WHEN others THEN ok := false; END;
        ELSE
          -- free-text: single string uses substring (includes) match, like the
          -- client; anything else is treated as "accept any input".
          IF jsonb_typeof(ans) = 'string' THEN
            n1 := public.norm_eq(ua);
            n2 := public.norm_eq(ans #>> '{}');
            ok := position(n2 in n1) > 0;
          ELSE
            ok := true;
          END IF;
        END IF;
      END IF;
      IF graded THEN
        res := res || jsonb_build_object(idx::text, CASE WHEN ok THEN 'correct' ELSE 'wrong' END);
      END IF;
      idx := idx + 1;
    END LOOP;
    RETURN res;
  END;
$$;

-- 9. Helpers used by check_exercise for progress_table species ordering.
CREATE OR REPLACE FUNCTION public.question_block(cj jsonb, idx int)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  items jsonb;
  sec jsonb;
  blocks jsonb;
  b jsonb;
  n int := 0;
BEGIN
  IF cj IS NULL THEN RETURN NULL; END IF;
  items := COALESCE(cj->'sections', cj->'blocks', cj);
  IF jsonb_typeof(items) <> 'array' THEN RETURN NULL; END IF;
  FOR sec IN SELECT * FROM jsonb_array_elements(items)
  LOOP
    IF sec ? 'blocks' THEN blocks := sec->'blocks'; ELSE blocks := jsonb_build_array(sec); END IF;
    FOR b IN SELECT * FROM jsonb_array_elements(blocks)
    LOOP
      IF b->>'type' = 'question' THEN
        IF n = idx THEN RETURN b; END IF;
        n := n + 1;
      END IF;
    END LOOP;
  END LOOP;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.parse_species(eq text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  sides text[];
  parts text[];
  out jsonb := '[]'::jsonb;
  s text;
  p text;
  sp text;
BEGIN
  IF eq IS NULL THEN RETURN '[]'::jsonb; END IF;
  sides := regexp_split_to_array(eq, '[=→⇌⟶]');
  IF array_length(sides, 1) < 2 THEN RETURN '[]'::jsonb; END IF;
  FOR s IN SELECT * FROM unnest(sides)
  LOOP
    parts := regexp_split_to_array(s, '\s*\+\s*');
    FOR p IN SELECT * FROM unnest(parts)
    LOOP
      sp := btrim(regexp_replace(p, '\([slgq]\)', '', 'g'));
      IF sp <> '' THEN out := out || jsonb_build_array(sp); END IF;
    END LOOP;
  END LOOP;
  RETURN out;
END $$;

GRANT EXECUTE ON FUNCTION public.check_exercise(int, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_exercise_content(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.extract_answer_key(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.answerable_from_key(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.strip_answers(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.norm_eq(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.question_block(jsonb, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.parse_species(text) TO authenticated;
