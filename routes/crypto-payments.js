require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { ethers } = require('ethers');
const { body, query, param, validationResult } = require('express-validator');
const { requireAuth, requireTeacherOrAdmin } = require('../middleware/supabase');
const { sendReceipt } = require('../lib/mail');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BSC_RPC = 'https://bsc-dataseed1.binance.org/';
const USDT_BSC_ADDRESS = '0x55d398326f99059fF775485246999027B3197955';
const RECEIVER_WALLET = process.env.MY_PERSONAL_RECEIVING_WALLET;
const BINANCE_USDT_FEE = parseFloat(process.env.BINANCE_USDT_FEE) || 0.30;

const ERC20_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)'
];

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Invalid input', details: errors.array().map(e => e.msg) });
  }
}

// POST /api/crypto/create-invoice
router.post('/create-invoice', requireAuth, [
  body('productId').isUUID().withMessage('Invalid productId'),
  body('paymentSource').optional().isIn(['binance', 'web3']).withMessage('Invalid paymentSource'),
], async (req, res) => {
  try {
    if (!handleValidation(req, res)) return;
    const userId = req.user.id;
    const { productId, paymentSource } = req.body;
    const source = paymentSource === 'binance' ? 'binance' : 'web3';

    const { data: product, error: pError } = await supabase
      .from('products')
      .select('id, title, description, type, duration_days, base_price')
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

    while (!isUnique && attempts < 100) {
      const randomFraction = (Math.floor(Math.random() * 999) + 1) / 100000;
      finalCryptoAmount = parseFloat((basePrice + randomFraction).toFixed(5));

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

    const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();

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
      .select('id, exact_crypto_amount, payment_source, status, expires_at')
      .single();

    if (iError) throw iError;

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
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/crypto/verify-payment
router.post('/verify-payment', requireAuth, [
  body('orderId').isUUID().withMessage('Invalid orderId'),
], async (req, res) => {
  try {
    if (!handleValidation(req, res)) return;
    const { orderId } = req.body;

    const { data: order, error: oError } = await supabase
      .from('payments')
      .select('id, status, expires_at, user_id, product_id, exact_crypto_amount, payment_source, products(title, type, duration_days)')
      .eq('id', orderId)
      .single();

    if (oError || !order) {
      return res.status(400).json({ error: 'Order not found' });
    }

    if (order.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (order.status === 'completed') {
      return res.status(200).json({ success: true, status: 'completed', message: 'Payment already verified' });
    }

    if (order.status === 'expired' || new Date(order.expires_at) < new Date()) {
      if (order.status === 'pending') {
        await supabase.from('payments').update({ status: 'expired' }).eq('id', orderId);
      }
      return res.status(200).json({ success: false, status: 'expired', message: 'Invoice expired. Please create a new one.' });
    }

    if (!RECEIVER_WALLET) {
      return res.status(500).json({ error: 'Payment system not configured' });
    }

    const provider = new ethers.JsonRpcProvider(BSC_RPC);
    const contract = new ethers.Contract(USDT_BSC_ADDRESS, ERC20_ABI, provider);

    const latestBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(latestBlock - 400, 0);

    const filter = contract.filters.Transfer(null, RECEIVER_WALLET);
    const logs = await contract.queryFilter(filter, fromBlock, latestBlock);

    let matched = false;
    let txHash = null;
    const expectedAmount = order.exact_crypto_amount;

    for (const log of logs) {
      const rawValue = log.args.value;
      const amountStr = ethers.formatUnits(rawValue, 18);

      const receivedCents = Math.round(parseFloat(amountStr) * 100000);
      const expectedCents = Math.round(expectedAmount * 100000);

      if (receivedCents === expectedCents) {
        matched = true;
        txHash = log.transactionHash;
        break;
      }
    }

    if (matched) {
      await supabase
        .from('payments')
        .update({ status: 'completed', tx_hash: txHash })
        .eq('id', orderId);

      let expiresAt = null;
      const productType = Array.isArray(order.products) ? order.products[0] : order.products;
      if (productType && productType.type === 'subscription' && productType.duration_days) {
        const exp = new Date();
        exp.setDate(exp.getDate() + productType.duration_days);
        expiresAt = exp.toISOString();
      }

      await supabase.from('user_access').insert([{
        user_id: order.user_id,
        product_id: order.product_id,
        expires_at: expiresAt,
        is_active: true
      }]);

      await supabase
        .from('profiles')
        .update({ subscription_active: true })
        .eq('id', order.user_id);

      const product = Array.isArray(order.products) ? order.products[0] : order.products;
      if (req.user.email) {
        sendReceipt({
          to: req.user.email,
          amount: order.exact_crypto_amount,
          currency: 'USDT',
          txId: txHash,
          productTitle: product && product.title,
          date: new Date().toLocaleString('fr-FR'),
          paymentSource: order.payment_source,
        });
      }

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
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/crypto/check-access
router.post('/check-access', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: access, error } = await supabase
      .from('user_access')
      .select('id, product_id, expires_at, is_active, products(title, type)')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (error) throw error;

    const now = new Date();
    const activeAccess = (access || []).filter(a => {
      if (!a.expires_at) return true;
      return new Date(a.expires_at) > now;
    });

    return res.status(200).json({
      hasAccess: activeAccess.length > 0,
      access: activeAccess
    });

  } catch (err) {
    console.error('Check access error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/crypto/products (public)
router.get('/products', async (req, res) => {
  try {
    const { data: products, error } = await supabase
      .from('products')
      .select('id, title, description, type, duration_days, base_price, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) throw error;
    return res.status(200).json(products || []);
  } catch (err) {
    console.error('Fetch products error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/crypto/products/all (admin)
router.get('/products/all', requireAuth, requireTeacherOrAdmin, async (req, res) => {
  try {
    const { data: products, error } = await supabase
      .from('products')
      .select('id, title, description, type, duration_days, base_price, is_active, sort_order, created_at')
      .order('sort_order', { ascending: true });

    if (error) throw error;
    return res.status(200).json(products || []);
  } catch (err) {
    console.error('Fetch all products error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/crypto/products (admin)
router.post('/products', requireAuth, requireTeacherOrAdmin, [
  body('title').isString().isLength({ min: 1, max: 200 }).withMessage('Title required (max 200 chars)'),
  body('type').isIn(['subscription', 'course', 'bundle']).withMessage('Invalid product type'),
  body('base_price').isFloat({ min: 0 }).withMessage('base_price must be a positive number'),
  body('duration_days').optional().isInt({ min: 1, max: 3650 }).withMessage('Duration must be 1-3650 days'),
  body('description').optional().isString().isLength({ max: 2000 }).withMessage('Description max 2000 chars'),
], async (req, res) => {
  try {
    if (!handleValidation(req, res)) return;
    const { id, title, description, type, duration_days, base_price, is_active, sort_order } = req.body;

    if (id) {
      const { data, error } = await supabase
        .from('products')
        .update({ title, description, type, duration_days, base_price, is_active, sort_order })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return res.status(200).json(data);
    } else {
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
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/crypto/products/:id (admin)
router.delete('/products/:id', requireAuth, requireTeacherOrAdmin, [
  param('id').isUUID().withMessage('Invalid product ID'),
], async (req, res) => {
  try {
    if (!handleValidation(req, res)) return;
    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    return res.status(200).json({ message: 'Product deleted' });
  } catch (err) {
    console.error('Delete product error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/crypto/payments (admin)
router.get('/payments', requireAuth, requireTeacherOrAdmin, [
  query('userId').optional().isUUID().withMessage('Invalid userId'),
  query('status').optional().isIn(['pending', 'completed', 'expired']).withMessage('Invalid status'),
], async (req, res) => {
  try {
    if (!handleValidation(req, res)) return;
    const { userId, status } = req.query;

    let queryBuilder = supabase
      .from('payments')
      .select('id, user_id, product_id, base_amount, exact_crypto_amount, status, payment_source, tx_hash, created_at, expires_at, products(title, type)');

    if (userId) {
      queryBuilder = queryBuilder.eq('user_id', userId);
    }
    if (status) {
      queryBuilder = queryBuilder.eq('status', status);
    }

    queryBuilder = queryBuilder.order('created_at', { ascending: false }).limit(100);

    const { data, error } = await queryBuilder;
    if (error) throw error;
    return res.status(200).json(data || []);
  } catch (err) {
    console.error('Fetch payments error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
