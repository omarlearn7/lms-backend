-- Migration 22: DZD pricing anchor + advanced payment attribution
-- Run this in Supabase SQL Editor
--
-- What it changes:
--   1. products    : DZD anchor price + family discount structure
--   2. payments    : payer wallet binding + rate snapshot + verification metadata
--   3. tx_hash     : globally UNIQUE -> each on-chain tx can complete exactly ONE invoice
--   4. new table   : incoming_transfers (admin reconcile queue + auto-match audit)

-- ---------------------------------------------------------------------------
-- 1. Products: DZD base price + family discount columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS base_price_dzd NUMERIC(12, 2),
    ADD COLUMN IF NOT EXISTS discount_2nd_pct NUMERIC(5, 2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS discount_3rd_pct NUMERIC(5, 2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS max_family_size INT DEFAULT 1;

-- ---------------------------------------------------------------------------
-- 2. Payments: payer binding, DZD snapshot, verification metadata
-- ---------------------------------------------------------------------------
ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS payer_address TEXT,
    ADD COLUMN IF NOT EXISTS from_address TEXT,
    ADD COLUMN IF NOT EXISTS rate_dzd_per_usdt NUMERIC(14, 4),
    ADD COLUMN IF NOT EXISTS base_amount_dzd NUMERIC(12, 2),
    ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP WITH TIME ZONE;

-- Each on-chain transaction can complete exactly ONE invoice.
-- NULL tx_hash rows (pending invoices) are allowed; only completed ones are constrained.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_tx_hash_unique
    ON public.payments(tx_hash)
    WHERE tx_hash IS NOT NULL;

-- Index for the scanner's sender-based matching
CREATE INDEX IF NOT EXISTS idx_payments_payer_status
    ON public.payments(payer_address, status);

-- ---------------------------------------------------------------------------
-- 3. Incoming transfer log (auto-match audit + admin reconcile queue)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.incoming_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tx_hash TEXT UNIQUE NOT NULL,
    from_address TEXT,
    amount NUMERIC(20, 6) NOT NULL,
    status TEXT DEFAULT 'unmatched'
        CHECK (status IN ('unmatched', 'matched', 'ignored')),
    matched_payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incoming_transfers_status
    ON public.incoming_transfers(status);
CREATE INDEX IF NOT EXISTS idx_incoming_transfers_hash
    ON public.incoming_transfers(tx_hash);

-- Sensitive table: only the service role (backend) and the admin API can access it.
ALTER TABLE public.incoming_transfers ENABLE ROW LEVEL SECURITY;
-- No public policies. Backend uses the service role; admins go through /api/crypto endpoints.
