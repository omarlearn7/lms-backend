-- Migration 12: Units and Exercises system
-- Creates unit grouping for lessons and an exercise system

-- Units table (groups lessons under a category/course)
CREATE TABLE IF NOT EXISTS units (
  id SERIAL PRIMARY KEY,
  category_id INT REFERENCES categories(id) ON DELETE SET NULL,
  title VARCHAR(255) NOT NULL,
  grade_level VARCHAR(50),
  order_index INT DEFAULT 0,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

-- Add unit_id to existing lessons
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS unit_id INT REFERENCES units(id) ON DELETE SET NULL;

-- Index for unit lookups
CREATE INDEX IF NOT EXISTS idx_units_category ON units(category_id);
CREATE INDEX IF NOT EXISTS idx_lessons_unit ON lessons(unit_id);

-- Exercises table
CREATE TABLE IF NOT EXISTS exercises (
  id SERIAL PRIMARY KEY,
  unit_id INT REFERENCES units(id) ON DELETE SET NULL,
  title VARCHAR(255),
  content_json JSONB NOT NULL,
  source VARCHAR(255),
  pdf_url TEXT,
  order_index INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

-- Exercise progress tracking
CREATE TABLE IF NOT EXISTS exercise_progress (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  exercise_id INT REFERENCES exercises(id) ON DELETE CASCADE,
  answers JSONB DEFAULT '{}'::jsonb,
  completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  UNIQUE(user_id, exercise_id)
);

-- Indexes for exercises
CREATE INDEX IF NOT EXISTS idx_exercises_unit ON exercises(unit_id);
CREATE INDEX IF NOT EXISTS idx_exercises_order ON exercises(order_index);
CREATE INDEX IF NOT EXISTS idx_exercise_progress_user ON exercise_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_exercise_progress_exercise ON exercise_progress(exercise_id);

-- Insert الفيزياء category
INSERT INTO categories (id, name, slug) VALUES (2, 'الفيزياء', 'physics')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug;

-- Insert the 8 units
INSERT INTO units (id, category_id, title, grade_level, order_index, description) VALUES
(1, 1, 'المتابعة الزمنية لتحول كيميائي', 'grade_3', 1, 'دراسة سرعة التفاعلات الكيميائية والعوامل المؤثرة فيها'),
(2, 2, 'تطور جملة ميكانيكية', 'grade_3', 2, 'دراسة حركة الأجسام: السقوط الشاقولي، حركة القذيفة، حركة الكواكب والأقمار'),
(3, 2, 'دراسة ظواهر كهربائية', 'grade_3', 3, 'دراسة دارات RC و RL'),
(4, 1, 'تطور جملة كيميائية نحو حالة التوازن', 'grade_3', 4, 'التوازن الكيميائي والتفاعلات المرافقة لتفاعل حمض-أساس'),
(5, 2, 'دراسة تحولات نووية', 'grade_3', 5, 'النشاط الإشعاعي والتحولات النووية المستحدثة'),
(6, 1, 'مراقبة تطور جملة كيميائية', 'grade_3', 6, 'مراقبة التفاعلات الكيميائية والأعمدة الكهربائية'),
(7, 2, 'تطور جملة مهتزة', 'grade_3', 7, 'الاهتزازات الحرة والقسرية للجمل الميكانيكية والكهربائية'),
(8, 2, 'ظواهر الانتشار', 'grade_3', 8, 'دراسة الموجات الميكانيكية المتوالية وظواهر الانتشار')
ON CONFLICT (id) DO UPDATE SET
  category_id = EXCLUDED.category_id,
  title = EXCLUDED.title,
  grade_level = EXCLUDED.grade_level,
  order_index = EXCLUDED.order_index,
  description = EXCLUDED.description;

-- Assign existing lessons to unit 1
UPDATE lessons SET unit_id = 1 WHERE category_id = 1;

-- RLS for exercises
ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercise_progress ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read exercises
DROP POLICY IF EXISTS "exercises_select" ON exercises;
CREATE POLICY "exercises_select" ON exercises
  FOR SELECT USING (auth.role() = 'authenticated');

-- Teachers/admins can insert/update/delete exercises
DROP POLICY IF EXISTS "exercises_insert" ON exercises;
CREATE POLICY "exercises_insert" ON exercises
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'teacher'))
  );

DROP POLICY IF EXISTS "exercises_update" ON exercises;
CREATE POLICY "exercises_update" ON exercises
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'teacher'))
  );

-- Exercise progress: users manage their own
DROP POLICY IF EXISTS "exercise_progress_select" ON exercise_progress;
CREATE POLICY "exercise_progress_select" ON exercise_progress
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "exercise_progress_insert" ON exercise_progress;
CREATE POLICY "exercise_progress_insert" ON exercise_progress
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "exercise_progress_update" ON exercise_progress;
CREATE POLICY "exercise_progress_update" ON exercise_progress
  FOR UPDATE USING (auth.uid() = user_id);

-- Also update the lessons table RLS for unit_id column (already existing)
-- Also add units RLS
ALTER TABLE units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "units_select" ON units;
CREATE POLICY "units_select" ON units
  FOR SELECT USING (auth.role() = 'authenticated');
