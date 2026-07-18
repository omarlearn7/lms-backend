-- Supabase PostgreSQL Schema Migration

-- Drop existing tables if needed (use with caution in production)
-- drop table if exists public.user_progress cascade;
-- drop table if exists public.sessions cascade;
-- drop table if exists public.videos cascade;
-- drop table if exists public.courses cascade;
-- drop table if exists public.course_categories cascade;
-- drop table if exists public.profiles cascade;
-- drop table if exists public.grade_levels cascade;
-- drop table if exists public.payments cascade;
-- drop table if exists public.subscription_plans cascade;

-- 1. Create Grade Levels Table
CREATE TABLE public.grade_levels (
    id SERIAL PRIMARY KEY,
    level_key VARCHAR(20) UNIQUE NOT NULL,
    level_name VARCHAR(50) NOT NULL
);

INSERT INTO public.grade_levels (level_key, level_name) VALUES
('grade_4', 'سنة رابعة متوسط'),
('grade_1', 'سنة أولى ثانوي'),
('grade_2', 'سنة ثانية ثانوي'),
('grade_3', 'سنة ثالثة ثانوي');

-- 2. Create Profiles Table (Linked to Supabase Auth)
-- This replaces the old 'users' table. Authentication is handled by Supabase.
CREATE TABLE public.profiles (
    id UUID references auth.users not null primary key,
    role VARCHAR(20) CHECK (role IN ('student', 'parent', 'teacher', 'admin')) DEFAULT 'student',
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    phone VARCHAR(30),
    telegram_id VARCHAR(255),
    grade_level VARCHAR(50) REFERENCES public.grade_levels(level_key) ON DELETE SET NULL,
    subscription_active BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Enable Row Level Security (RLS) on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public profiles are viewable by everyone."
  ON public.profiles FOR SELECT
  USING ( true );

CREATE POLICY "Users can insert their own profile."
  ON public.profiles FOR INSERT
  WITH CHECK ( auth.uid() = id );

CREATE POLICY "Users can update own profile."
  ON public.profiles FOR UPDATE
  USING ( auth.uid() = id );

-- 3. Create Course Categories
CREATE TABLE public.course_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 4. Create Courses
CREATE TABLE public.courses (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    category_id INT REFERENCES public.course_categories(id) ON DELETE SET NULL,
    grade_level VARCHAR(50) REFERENCES public.grade_levels(level_key) ON DELETE SET NULL,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 5. Create Videos (Lessons)
CREATE TABLE public.videos (
    id SERIAL PRIMARY KEY,
    course_id INT REFERENCES public.courses(id) ON DELETE CASCADE,
    youtube_video_id VARCHAR(255) NOT NULL, -- This will store the ID from the direct upload
    title VARCHAR(255) NOT NULL,
    description TEXT,
    published_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 6. Create Sessions (Live Classes)
CREATE TABLE public.sessions (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    course_id INT REFERENCES public.courses(id) ON DELETE SET NULL,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    duration INT DEFAULT 60,
    room_name VARCHAR(255) UNIQUE NOT NULL, -- Jitsi room name
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 7. Create Subscription Plans
CREATE TABLE public.subscription_plans (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    duration_days INT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- RLS Policies for Courses/Videos
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;

-- Only users with subscription_active = true OR role = 'admin'/'teacher' can view courses/videos
CREATE POLICY "Courses viewable by active subscribers or staff" ON public.courses
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND (subscription_active = true OR role IN ('admin', 'teacher'))
    )
  );

CREATE POLICY "Videos viewable by active subscribers or staff" ON public.videos
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND (subscription_active = true OR role IN ('admin', 'teacher'))
    )
  );
