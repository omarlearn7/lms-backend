-- Migration 10: Create account for Chahrazad Larbi (assistant)
-- Bypasses email confirmation by setting email_confirmed_at directly
-- After running this, she can log in with the temp password and change it later

-- Ensure pgcrypto is available (for password hashing)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  new_user_id UUID := gen_random_uuid();
  temp_password TEXT := 'Chahrazad2026!';
  user_email TEXT := 'larbichahrazad99@gmail.com';
BEGIN
  -- Insert into auth.users (minimal columns only)
  INSERT INTO auth.users (
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  ) VALUES (
    new_user_id,
    'authenticated',
    'authenticated',
    user_email,
    crypt(temp_password, gen_salt('bf')),
    NOW(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object(
      'first_name', 'شهزاد',
      'last_name', 'لعربي',
      'role', 'student'
    ),
    NOW(),
    NOW()
  );

  -- Insert into auth.identities (required for Supabase auth)
  INSERT INTO auth.identities (
    id,
    user_id,
    provider_id,
    identity_data,
    provider,
    created_at,
    updated_at
  ) VALUES (
    new_user_id,
    new_user_id,
    user_email,
    jsonb_build_object(
      'sub', new_user_id::text,
      'email', user_email
    ),
    'email',
    NOW(),
    NOW()
  );

  -- Insert into profiles table
  INSERT INTO profiles (
    id,
    first_name,
    last_name,
    role,
    subscription_active,
    created_at
  ) VALUES (
    new_user_id,
    'شهزاد',
    'لعربي',
    'student',
    false,
    NOW()
  );

  RAISE NOTICE 'Account created for % (ID: %)', user_email, new_user_id;
  RAISE NOTICE 'Password: %', temp_password;
END $$;
