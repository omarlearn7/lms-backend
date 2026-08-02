-- Migration 14: Auto-create profiles on new signups
-- Fixes: students who confirmed via email had no `profiles` row,
-- so Lessons.jsx showed "no lessons" even when their level's content exists.

-- Function: build a profile row from the signup metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, role, first_name, last_name, grade_level, phone, country)
  VALUES (
    NEW.id,
    CASE WHEN NEW.raw_user_meta_data->>'role' IN ('student', 'parent', 'teacher', 'admin')
         THEN NEW.raw_user_meta_data->>'role' ELSE 'student' END,
    NULLIF(NEW.raw_user_meta_data->>'first_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'last_name', ''),
    CASE WHEN NEW.raw_user_meta_data->>'grade_level' IN ('grade_1', 'grade_2', 'grade_3', 'grade_4')
         THEN NEW.raw_user_meta_data->>'grade_level' END,
    NULLIF(NEW.raw_user_meta_data->>'phone', ''),
    NULLIF(NEW.raw_user_meta_data->>'country', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
