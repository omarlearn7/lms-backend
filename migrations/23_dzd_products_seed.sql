-- Migration 23: Seed DZD-anchored subscription products (family grid)
-- Run this in Supabase SQL Editor AFTER migration 22.
--
-- Plans (user-approved):
--   1-Month   1500 DA   (6.17 USDT fallback)  duration 30  days
--   3+1 Month 4500 DA   (18.51 USDT fallback) duration 120 days
--   6+2 Month 8000 DA   (32.91 USDT fallback) duration 240 days
--
-- Family / sibling grid per student:
--   1st student: 100% | 2nd: -20% | 3rd: -40%   (max family size = 3)
--
-- base_price_dzd is the DZD anchor used at invoice time (converted to USDT
-- via the live Binance P2P BUY rate). base_price is the legacy USDT fallback
-- used only when the live rate is unavailable.
--
-- Idempotent: updates rows that already have the same title, inserts new ones.

DO $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN
    SELECT * FROM (VALUES
      ('اشتراك شهري - شهر واحد'::text, 1500::numeric, 6.17::numeric, 30::int, 1::int),
      ('اشتراك 3+1 أشهر'::text,        4500::numeric, 18.51::numeric, 120::int, 2::int),
      ('اشتراك 6+2 أشهر'::text,        8000::numeric, 32.91::numeric, 240::int, 3::int)
    ) AS t(title, dzd, usdt, days, ord)
  LOOP
    IF EXISTS (SELECT 1 FROM public.products WHERE title = p.title) THEN
      UPDATE public.products SET
        base_price_dzd = p.dzd,
        base_price = p.usdt,
        type = 'subscription',
        duration_days = p.days,
        is_active = true,
        sort_order = p.ord,
        discount_2nd_pct = 20,
        discount_3rd_pct = 40,
        max_family_size = 3
      WHERE title = p.title;
    ELSE
      INSERT INTO public.products
        (title, description, type, duration_days, base_price, base_price_dzd,
         is_active, sort_order, discount_2nd_pct, discount_3rd_pct, max_family_size)
      VALUES
        (p.title, NULL, 'subscription', p.days, p.usdt, p.dzd, true, p.ord, 20, 40, 3);
    END IF;
  END LOOP;
END $$;
