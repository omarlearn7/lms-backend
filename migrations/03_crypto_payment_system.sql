-- Migration 03: BNB Chain Crypto Payment System
-- Run this in Supabase SQL Editor

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Admin Product Catalog (dynamic pricing, admin-configurable)
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL CHECK (type IN ('one-time', 'subscription')),
    duration_days INT, -- NULL = lifetime access, 30 = monthly, etc.
    base_price NUMERIC(10, 2) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Crypto Payments Log (with micro-decimal unique identification)
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    base_amount NUMERIC(10, 2) NOT NULL,
    exact_crypto_amount NUMERIC(20, 5) UNIQUE NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'expired')),
    tx_hash TEXT, -- Blockchain transaction hash when confirmed
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '20 minutes')
);

-- 3. User Access Registry (LMS permissions after payment)
CREATE TABLE IF NOT EXISTS user_access (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE CASCADE,
    granted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE, -- NULL = permanent lifetime unlock
    is_active BOOLEAN DEFAULT true
);

-- Optimization indexes
CREATE INDEX IF NOT EXISTS idx_payments_amount_status ON payments(exact_crypto_amount, status);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_user_access_lookup ON user_access(user_id, product_id, is_active);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);

-- Enable RLS on new tables
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_access ENABLE ROW LEVEL SECURITY;

-- Products: everyone can read active products, only admin can modify
CREATE POLICY "Anyone can view active products"
    ON public.products FOR SELECT
    USING (is_active = true);

CREATE POLICY "Admin can manage products"
    ON public.products FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- Payments: users can see their own, admin can see all
CREATE POLICY "Users can view own payments"
    ON public.payments FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Admin can view all payments"
    ON public.payments FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- Payments: backend inserts via service_role (bypasses RLS)
-- No INSERT policy for public - only service_role can create invoices

CREATE POLICY "Admin can update payments"
    ON public.payments FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- User Access: users can read own access, backend inserts via service_role
CREATE POLICY "Users can view own access"
    ON public.user_access FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Admin can manage access"
    ON public.user_access FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- Enable Supabase Realtime on payments table for live checkout UI updates
ALTER PUBLICATION supabase_realtime ADD TABLE payments;

-- Seed default products
INSERT INTO products (title, description, type, duration_days, base_price, sort_order) VALUES
('اشتراك شهري - الدروس فقط', 'وصول كامل لجميع دروس الفيديو لمدة 30 يوماً', 'subscription', 30, 5.00, 1),
('اشتراك شهري - شامل', 'وصول كامل للدروس + حصص البث المباشر التفاعلي لمدة 30 يوماً', 'subscription', 30, 10.00, 2),
('وصول دائم - الدروس فقط', 'وصول دائم لجميع دروس الفيديو بدون انتهاء', 'one-time', NULL, 25.00, 3),
('وصول دائم - شامل', 'وصول دائم كامل للدروس + حصص البث المباشر', 'one-time', NULL, 50.00, 4);
