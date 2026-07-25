-- Migration 07: Add R2 video support to videos table

-- 1. Add source type (youtube or r2)
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS source_type VARCHAR(10) DEFAULT 'youtube';

-- 2. Add R2 storage columns
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS r2_key VARCHAR(500) DEFAULT NULL;
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS r2_bucket VARCHAR(255) DEFAULT NULL;
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS hls_manifest_key VARCHAR(500) DEFAULT NULL;

-- 3. Make youtube_video_id nullable (was NOT NULL, now optional since R2 videos don't have it)
ALTER TABLE public.videos ALTER COLUMN youtube_video_id DROP NOT NULL;
