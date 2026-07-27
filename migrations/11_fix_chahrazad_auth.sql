-- Migration 11: Fix Chahrazad's broken auth user
-- The previous migration created auth.users row but identities insert failed,
-- leaving a ghost user that can't log in and can't be deleted via admin API.
-- This deletes the broken user and recreates everything properly in one atomic DO block.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  broken_user_id UUID;
  new_user_id UUID := gen_random_uuid();
  temp_password TEXT := 'Chahrazad2026!';
  user_email TEXT := 'larbichahrazad99@gmail.com';
BEGIN
  -- Find and delete the broken user (no identities)
  SELECT id INTO broken_user_id
  FROM auth.users
  WHERE email = user_email
  LIMIT 1;

  IF broken_user_id IS NOT NULL THEN
    DELETE FROM auth.identities WHERE user_id = broken_user_id;
    DELETE FROM auth.refresh_tokens WHERE user_id = broken_user_id;
    DELETE FROM auth.users WHERE id = broken_user_id;
    RAISE NOTICE 'Deleted broken user ID: %', broken_user_id;
  END IF;

  -- Create fresh user
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) VALUES (
    new_user_id, 'authenticated', 'authenticated', user_email,
    crypt(temp_password, gen_salt('bf')),
    NOW(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object(
      'first_name', 'شهزاد', 'last_name', 'لعربي', 'role', 'student'
    ),
    NOW(), NOW()
  );

  INSERT INTO auth.identities (
    id, user_id, provider_id, identity_data, provider,
    created_at, updated_at
  ) VALUES (
    new_user_id, new_user_id, user_email,
    jsonb_build_object('sub', new_user_id::text, 'email', user_email),
    'email', NOW(), NOW()
  );

  INSERT INTO profiles (
    id, first_name, last_name, role, subscription_active, created_at
  ) VALUES (
    new_user_id, 'شهزاد', 'لعربي', 'student', false, NOW()
  );

  RAISE NOTICE 'Created new user for % (ID: %)', user_email, new_user_id;
  RAISE NOTICE 'Login: % / %', user_email, temp_password;
END $$;
