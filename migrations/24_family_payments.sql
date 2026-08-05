-- Migration 24: Family subscription support on invoices
-- Run this in Supabase SQL Editor AFTER migration 22/23.
--
-- What it changes:
--   1. payments.family_size : number of covered students (1 = individual).
--      create-invoice multiplies the DZD base by the family discount grid
--      (1st 100%, 2nd -20%, 3rd -40%) and records the size here so admins
--      can see how many students an invoice actually covers.
--
-- Idempotent: safe to run multiple times.

ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS family_size INT DEFAULT 1;

COMMENT ON COLUMN public.payments.family_size IS
    'Number of students covered by this invoice (1 = individual, 2 = parent + 2nd child at -20%, 3 = -40%).';
