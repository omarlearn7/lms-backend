-- Migration: Add role-specific profile fields & parent-child reference
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS parent_type VARCHAR(50),
ADD COLUMN IF NOT EXISTS teaching_subject VARCHAR(100),
ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Comment for clarity
COMMENT ON COLUMN public.profiles.parent_type IS 'Kinship relation for parent role (e.g., father, mother, guardian)';
COMMENT ON COLUMN public.profiles.teaching_subject IS 'Teaching subject for teacher role (e.g., Physics, Math)';
COMMENT ON COLUMN public.profiles.parent_id IS 'Reference to parent profile ID linking a student to their parent';

-- Policy allowing parents to view profiles of their linked children
CREATE POLICY "Parents can view linked children profiles"
  ON public.profiles FOR SELECT
  USING ( auth.uid() = parent_id OR auth.uid() = id );
