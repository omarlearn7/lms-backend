-- Migration 04: Add payment_source column to payments table
-- Run this in Supabase SQL Editor

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS payment_source VARCHAR(20) DEFAULT 'web3';

COMMENT ON COLUMN public.payments.payment_source IS 'Payment source: web3 (MetaMask/Trust Wallet) or binance (Binance exchange withdrawal)';
