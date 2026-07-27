-- Migration 09: Fix lessons RLS policy (auth.role() is deprecated in modern Supabase)

-- Drop the broken policy that uses auth.role()
DROP POLICY IF EXISTS "lessons_select" ON lessons;

-- Recreate with a working check: any authenticated user (valid JWT = auth.uid() is not null)
CREATE POLICY "lessons_select" ON lessons
  FOR SELECT USING (auth.uid() IS NOT NULL);
