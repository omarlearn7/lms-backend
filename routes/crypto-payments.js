require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { ethers } = require('ethers');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// BNB Smart Chain configuration
const BSC_RPC = 'https://bsc-dataseed1.binance.org/';
const USDT_BSC_ADDRESS = '0x55d398326f99059fF775485246999027B3197955';
const RECEIVER_WALLET = process.env.MY_PERSONAL_RECEIVING_WALLET;
const BINANCE_USDT_FEE = parseFloat(process.env.BINANCE_USDT_FEE) || 0.30;

// Minimal ERC-20 ABI for Transfer event scanning
const ERC20_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)'
];

// POST /api/crypto/create-invoice
// Creates a pending payment with a unique micro-decimal amount
router.post('/create-invoice', async (req, res) => {
  try {
    const { userId, productId, paymentSource } = req.body;
    const source = paymentSource === 'binance' ? 'binance' : 'web3';

    if (!userId || !productId) {
      return res.status(400).json({ error: 'userId and productId are required' });
    }

    // Fetch product details
    const { data: product, error: pError } = await supabase
      .from('products')
      .select('*')
      .eq('id', productId)
      .eq('is_active', true)
      .single();

    if (pError || !product) {
      return res.status(404).json({ error: 'Product not found or inactive' });
    }

    const basePrice = parseFloat(product.base_price);
    let isUnique = false;
    let finalCryptoAmount = basePrice;
    let attempts = 0;

    // Generate a unique micro-decimal amount to avoid collisions
    while (!isUnique && attempts < 100) {
      const randomFraction = (Math.floor(Math.random() * 999) + 1) / 100000;
      finalCryptoAmount = parseFloat((basePrice + randomFraction).toFixed(5));

      // Check for collision with existing pending payments
      const { data: collision } = await supabase
        .from('payments')
        .select('id')
        .eq('exact_crypto_amount', finalCryptoAmount)
        .eq('status', 'pending');

      if (!collision || collision.length === 0) {
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique) {
      return res.status(500).json({ error: 'Could not generate unique amount, try again' });
    }

    // Calculate expiration (20 minutes from now)
    const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();

    // Insert pending payment record
    const { data: invoice, error: iError } = await supabase
      .from('payments')
      .insert([{
        user_id: userId,
        product_id: productId,
        base_amount: basePrice,
        exact_crypto_amount: finalCryptoAmount,
        payment_source: source,
        status: 'pending',
        expires_at: expiresAt
      }])
      .select()
      .single();

    if (iError) throw iError;

    // Calculate display amount for user (adds Binance fee if applicable)
    const displayAmount = source === 'binance'
      ? parseFloat((finalCryptoAmount + BINANCE_USDT_FEE).toFixed(5))
      : finalCryptoAmount;

    return res.status(200).json({
      ...invoice,
      display_amount: displayAmount,
      binance_fee: source === 'binance' ? BINANCE_USDT_FEE : 0,
      product_title: product.title,
      product_description: product.description,
      product_type: product.type,
      duration_days: product.duration_days,
      receiver_wallet: RECEIVER_WALLET,
      network: 'BSC (BNB Smart Chain)',
      token: 'USDT (BEP-20)',
      token_address: USDT_BSC_ADDRESS
    });

  } catch (err) {
    console.error('Create invoice error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/crypto/verify-payment
// Checks BSC blockchain for matching Transfer event
router.post('/verify-payment', async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }

    // Fetch the pending order
    const { data: order, error: oError } = await supabase
      .from('payments')
      .select('*, products(*)')
      .eq('id', orderId)
      .single();

    if (oError || !order) {
      return res.status(400).json({ error: 'Order not found' });
    }

    if (order.status === 'completed') {
      return res.status(200).json({ success: true, status: 'completed', message: 'Payment already verified' });
    }

    if (order.status === 'expired' || new Date(order.expires_at) < new Date()) {
      // Auto-expire if past expiration
      if (order.status === 'pending') {
        await supabase.from('payments').update({ status: 'expired' }).eq('id', orderId);
      }
      return res.status(200).json({ success: false, status: 'expired', message: 'Invoice expired. Please create a new one.' });
    }

    if (!RECEIVER_WALLET) {
      return res.status(500).json({ error: 'Receiver wallet not configured on server' });
    }

    // Connect to BSC
    const provider = new ethers.JsonRpcProvider(BSC_RPC);
    const contract = new ethers.Contract(USDT_BSC_ADDRESS, ERC20_ABI, provider);

    // Scan recent blocks (~20 minutes of history = ~400 blocks on BSC)
    const latestBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(latestBlock - 400, 0);

    const filter = contract.filters.Transfer(null, RECEIVER_WALLET);
    const logs = await contract.queryFilter(filter, fromBlock, latestBlock);

    let matched = false;
    let txHash = null;

    for (const log of logs) {
      const rawValue = log.args.value;
      const amountStr = ethers.formatUnits(rawValue, 18); // USDT on BSC = 18 decimals

      if (parseFloat(amountStr) === parseFloat(order.exact_crypto_amount)) {
        matched = true;
        txHash = log.transactionHash;
        break;
      }
    }

    if (matched) {
      // Update payment status
      await supabase
        .from('payments')
        .update({ status: 'completed', tx_hash: txHash })
        .eq('id', orderId);

      // Grant user access based on product type
      let expiresAt = null;
      if (order.products && order.products.type === 'subscription' && order.products.duration_days) {
        const exp = new Date();
        exp.setDate(exp.getDate() + order.products.duration_days);
        expiresAt = exp.toISOString();
      }

      // Insert access record
      await supabase.from('user_access').insert([{
        user_id: order.user_id,
        product_id: order.product_id,
        expires_at: expiresAt,
        is_active: true
      }]);

      // Also update subscription_active on profiles for backward compatibility
      await supabase
        .from('profiles')
        .update({ subscription_active: true })
        .eq('id', order.user_id);

      return res.status(200).json({
        success: true,
        status: 'completed',
        message: 'Payment verified! Access granted.',
        tx_hash: txHash
      });
    }

    return res.status(200).json({
      success: false,
      status: 'pending',
      message: 'Transaction not detected yet. Please wait a moment and try again.'
    });

  } catch (err) {
    console.error('Verify payment error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/crypto/check-access
// Check if a user has active access
router.post('/check-access', async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const { data: access, error } = await supabase
      .from('user_access')
      .select('*, products(*)')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (error) throw error;

    // Filter out expired access
    const now = new Date();
    const activeAccess = (access || []).filter(a => {
      if (!a.expires_at) return true; // lifetime access
      return new Date(a.expires_at) > now;
    });

    return res.status(200).json({
      hasAccess: activeAccess.length > 0,
      access: activeAccess
    });

  } catch (err) {
    console.error('Check access error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/crypto/products
// List all active products (public)
router.get('/products', async (req, res) => {
  try {
    const { data: products, error } = await supabase
      .from('products')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) throw error;
    return res.status(200).json(products || []);
  } catch (err) {
    console.error('Fetch products error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/crypto/products/all
// List ALL products including inactive (admin only - uses service_role)
router.get('/products/all', async (req, res) => {
  try {
    const { data: products, error } = await supabase
      .from('products')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) throw error;
    return res.status(200).json(products || []);
  } catch (err) {
    console.error('Fetch all products error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/crypto/products
// Create or update a product (admin)
router.post('/products', async (req, res) => {
  try {
    const { id, title, description, type, duration_days, base_price, is_active, sort_order } = req.body;

    if (!title || !type || base_price === undefined) {
      return res.status(400).json({ error: 'title, type, and base_price are required' });
    }

    if (id) {
      // Update existing product
      const { data, error } = await supabase
        .from('products')
        .update({ title, description, type, duration_days, base_price, is_active, sort_order })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return res.status(200).json(data);
    } else {
      // Create new product
      const { data, error } = await supabase
        .from('products')
        .insert([{ title, description, type, duration_days, base_price, is_active, sort_order }])
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json(data);
    }
  } catch (err) {
    console.error('Save product error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/crypto/products/:id
// Delete a product (admin)
router.delete('/products/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    return res.status(200).json({ message: 'Product deleted' });
  } catch (err) {
    console.error('Delete product error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/crypto/payments
// List all payments (admin) or user's own payments
router.get('/payments', async (req, res) => {
  try {
    const { userId, status } = req.query;

    let query = supabase.from('payments').select('*, products(title, type)');

    if (userId) {
      query = query.eq('user_id', userId);
    }
    if (status) {
      query = query.eq('status', status);
    }

    query = query.order('created_at', { ascending: false }).limit(100);

    const { data, error } = await query;
    if (error) throw error;
    return res.status(200).json(data || []);
  } catch (err) {
    console.error('Fetch payments error:', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
