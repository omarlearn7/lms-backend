-- Migration 15: Backfill profiles for existing auth users that never got one
-- (signups that happened before Migration 14's trigger existed).
-- Also set the confirmed 3AS student (956bdf91-ac47-4dce-aa96-7b7de8631cc7)
-- to grade_3, matching the level chosen at signup.

INSERT INTO public.profiles (id, role, first_name, last_name, grade_level, phone, country)
SELECT
  u.id,
  CASE WHEN u.raw_user_meta_data->>'role' IN ('student', 'parent', 'teacher', 'admin')
       THEN u.raw_user_meta_data->>'role' ELSE 'student' END,
  NULLIF(u.raw_user_meta_data->>'first_name', ''),
  NULLIF(u.raw_user_meta_data->>'last_name', ''),
  CASE WHEN u.raw_user_meta_data->>'grade_level' IN ('grade_1', 'grade_2', 'grade_3', 'grade_4')
       THEN u.raw_user_meta_data->>'grade_level' END,
  NULLIF(u.raw_user_meta_data->>'phone', ''),
  NULLIF(u.raw_user_meta_data->>'country', '')
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;

-- Fix the confirmed 3AS (سنة ثالثة ثانوي) student
UPDATE public.profiles
SET grade_level = 'grade_3'
WHERE id = '956bdf91-ac47-4dce-aa96-7b7de8631cc7';
