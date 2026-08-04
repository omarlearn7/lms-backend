require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { ethers } = require('ethers');
const { body, query, param, validationResult } = require('express-validator');
const { requireAuth, requireAdmin } = require('../middleware/supabase');
const { sendReceipt } = require('../lib/mail');
const rateLimit = require('express-rate-limit');
const { getDzdRate, dzdToUsdt } = require('../lib/p2p-rate');
const { getProvider } = require('../lib/bsc-rpc');
const { scanOnce, completePayment, reconcileExpiredFlags, fetchIncomingTransfers } = require('../lib/payment-scanner');

const router = express.Router();

const cryptoWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests to this endpoint.' },
});

const adminOpsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin operations.' },
});

const GRACE_PERIOD_MS = 60 * 24 * 60 * 60 * 1000; // 60 days after trial ends

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

const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;
const TXHASH_RE = /0x[a-fA-F0-9]{64}/;

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Invalid input', details: errors.array().map(e => e.msg) });
  }
}

async function fetchOrder(orderId) {
  const { data, error } = await supabase
    .from('payments')
    .select('id, status, expires_at, user_id, product_id, exact_crypto_amount, payer_address, payment_source, products(title, type, duration_days)')
    .eq('id', orderId)
    .single();
  if (error || !data) return null;
  return data;
}

async function markExpired(orderId) {
  await supabase.from('payments').update({ status: 'expired' }).eq('id', orderId);
}

async function verifyTransferOnChain(txHash) {
  // Returns { from, amountStr } if the tx contains a USDT transfer of the
  // expected amount to the platform wallet, else null.
  const provider = await getProvider();
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) return { found: false, reason: 'not_found' };
  const contract = new ethers.Contract(USDT_BSC_ADDRESS, ERC20_ABI, provider);
  for (const log of receipt.logs) {
    if (String(log.address).toLowerCase() !== USDT_BSC_ADDRESS.toLowerCase()) continue;
    let parsed;
    try {
      parsed = contract.interface.parseLog(log);
    } catch (e) {
      continue;
    }
    if (!parsed || !parsed.args) continue;
    const from = parsed.args.from;
    const to = parsed.args.to;
    const value = parsed.args.value;
    if (!to || String(to).toLowerCase() !== RECEIVER_WALLET.toLowerCase()) continue;
    return { found: true, from, amountStr: ethers.formatUnits(value, 18) };
  }
  return { found: false, reason: 'no_transfer' };
}

async function sendReceiptFor(req, order, txHash) {
  const product = Array.isArray(order.products) ? order.products[0] : order.products;
  if (req.user && req.user.email) {
    try {
      await sendReceipt({
        to: req.user.email,
        amount: order.exact_crypto_amount,
        currency: 'USDT',
        txId: txHash,
        productTitle: product && product.title,
        date: new Date().toLocaleString('fr-FR'),
        paymentSource: order.payment_source,
      });
    } catch (err) {
      console.error('Receipt email error:', err);
    }
  }
}

// ---------------------------------------------------------------------------
// POST /api/crypto/create-invoice
// ---------------------------------------------------------------------------
router.post('/create-invoice', requireAuth, cryptoWriteLimiter, [
  body('productId').isUUID().withMessage('Invalid productId'),
  body('paymentSource').optional().isIn(['binance', 'web3']).withMessage('Invalid paymentSource'),
  body('payerAddress').matches(WALLET_RE).withMessage('Payer wallet address is required and must be a valid 0x... address'),
], async (req, res) => {
  try {
    if (!handleValidation(req, res)) return;
    const userId = req.user.id;
    const { productId, paymentSource, payerAddress } = req.body;
    const source = paymentSource === 'binance' ? 'binance' : 'web3';
    const payerAddressLower = String(payerAddress).toLowerCase();

    const { data: product, error: pError } = await supabase
      .from('products')
      .select('id, title, description, type, duration_days, base_price, base_price_dzd')
      .eq('id', productId)
      .eq('is_active', true)
      .single();

    if (pError || !product) {
      return res.status(404).json({ error: 'Product not found or inactive' });
    }

    // DZD-anchored pricing: convert via the LIVE Binance P2P rate.
    // Falls back to the legacy USDT base price if the live rate is unavailable.
    let basePriceUsdt;
    let baseAmountDzd = null;
    let rateSnapshot = null;
    if (product.base_price_dzd != null) {
      try {
        const rateData = await getDzdRate();
        // Use the BUY side (what the user actually pays to acquire USDT on P2P)
        // so the USDT amount equals the advertised DZD price.
        basePriceUsdt = dzdToUsdt(parseFloat(product.base_price_dzd), rateData.buy);
        baseAmountDzd = parseFloat(product.base_price_dzd);
        rateSnapshot = { rate: rateData.buy, buy: rateData.buy, sell: rateData.sell, mid: rateData.rate };
      } catch (rateErr) {
        console.error('Live rate unavailable, using USDT base:', rateErr.message);
        basePriceUsdt = parseFloat(product.base_price);
      }
    } else {
      basePriceUsdt = parseFloat(product.base_price);
    }

    // Unique micro-decimal amount (defense-in-depth; sender binding is primary).
    let isUnique = false;
    let finalCryptoAmount = basePriceUsdt;
    let attempts = 0;
    while (!isUnique && attempts < 100) {
      const randomFraction = (Math.floor(Math.random() * 999) + 1) / 100000;
      finalCryptoAmount = parseFloat((basePriceUsdt + randomFraction).toFixed(5));

      const { data: collision } = await supabase
        .from('payments')
        .select('id')
        .eq('exact_crypto_amount', finalCryptoAmount)
        .eq('status', 'pending');

      if (!collision || collision.length === 0) isUnique = true;
      attempts++;
    }

    if (!isUnique) {
      return res.status(500).json({ error: 'Could not generate unique amount, try again' });
    }

    // Check the bound wallet actually holds enough USDT (non-blocking UX hint).
    let payerBalance = null;
    try {
      const provider = await getProvider();
      const contract = new ethers.Contract(USDT_BSC_ADDRESS, ERC20_ABI, provider);
      const bal = await contract.balanceOf(payerAddressLower);
      payerBalance = parseFloat(ethers.formatUnits(bal, 18));
    } catch (err) {
      console.error('Balance check error:', err.message);
    }

    const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();

    const { data: invoice, error: iError } = await supabase
      .from('payments')
      .insert([{
        user_id: userId,
        product_id: productId,
        base_amount: parseFloat(basePriceUsdt.toFixed(5)),
        exact_crypto_amount: finalCryptoAmount,
        base_amount_dzd: baseAmountDzd,
        rate_dzd_per_usdt: rateSnapshot ? rateSnapshot.rate : null,
        payer_address: payerAddressLower,
        payment_source: source,
        status: 'pending',
        expires_at: expiresAt
      }])
      .select('id, exact_crypto_amount, base_amount_dzd, rate_dzd_per_usdt, payer_address, payment_source, status, expires_at')
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
      token_address: USDT_BSC_ADDRESS,
      rate: rateSnapshot,
      payer_balance: payerBalance,
    });

  } catch (err) {
    console.error('Create invoice error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/crypto/verify-payment
// Re-scans recent blocks for a transfer that matches this invoice
// (sender address + amount). Completion is atomic + tx_hash consumed once.
// ---------------------------------------------------------------------------
router.post('/verify-payment', requireAuth, cryptoWriteLimiter, [
  body('orderId').isUUID().withMessage('Invalid orderId'),
], async (req, res) => {
  try {
    if (!handleValidation(req, res)) return;
    const { orderId } = req.body;

    const order = await fetchOrder(orderId);
    if (!order) return res.status(400).json({ error: 'Order not found' });
    if (order.user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });
    if (order.status === 'completed') {
      return res.status(200).json({ success: true, status: 'completed', message: 'Payment already verified' });
    }
    if (order.status === 'expired' || new Date(order.expires_at) < new Date()) {
      if (order.status === 'pending') await markExpired(orderId);
      return res.status(200).json({ success: false, status: 'expired', message: 'Invoice expired. Please create a new one.' });
    }
    if (!RECEIVER_WALLET) return res.status(500).json({ error: 'Payment system not configured' });

    const provider = await getProvider();
    const contract = new ethers.Contract(USDT_BSC_ADDRESS, ERC20_ABI, provider);

    const latestBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(latestBlock - 400, 0);
    const logs = await fetchIncomingTransfers(provider, contract, fromBlock, latestBlock);

    const expectedCents = Math.round(parseFloat(order.exact_crypto_amount) * 1e6);
    let txHash = null;
    let fromAddress = null;

    for (const log of logs) {
      const receivedCents = Math.round(parseFloat(ethers.formatUnits(log.args.value, 18)) * 1e6);
      if (receivedCents !== expectedCents) continue;
      const from = log.args.from;
      if (order.payer_address && String(from).toLowerCase() !== String(order.payer_address).toLowerCase()) continue;
      txHash = log.transactionHash;
      fromAddress = from;
      break;
    }

    if (txHash) {
      const didComplete = await completePayment(order, txHash, fromAddress);
      if (didComplete) await sendReceiptFor(req, order, txHash);
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

// ---------------------------------------------------------------------------
// POST /api/crypto/verify-by-txlink
// User pastes a BSCScan link / tx hash. We pull THAT exact tx on-chain and
// verify receiver + amount. Works for Binance-direct withdrawals and any
// wallet. tx_hash is consumed once via the unique DB constraint.
// ---------------------------------------------------------------------------
router.post('/verify-by-txlink', requireAuth, cryptoWriteLimiter, [
  body('orderId').isUUID().withMessage('Invalid orderId'),
  body('txLink').isString().isLength({ min: 10, max: 2000 }).withMessage('Transaction link is required'),
], async (req, res) => {
  try {
    if (!handleValidation(req, res)) return;
    const { orderId, txLink } = req.body;

    const order = await fetchOrder(orderId);
    if (!order) return res.status(400).json({ error: 'Order not found' });
    if (order.user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });
    if (order.status === 'completed') {
      return res.status(200).json({ success: true, status: 'completed', message: 'Payment already verified' });
    }
    if (order.status === 'expired' || new Date(order.expires_at) < new Date()) {
      if (order.status === 'pending') await markExpired(orderId);
      return res.status(200).json({ success: false, status: 'expired', message: 'Invoice expired. Please create a new one.' });
    }
    if (!RECEIVER_WALLET) return res.status(500).json({ error: 'Payment system not configured' });

    const match = String(txLink).match(TXHASH_RE);
    if (!match) {
      return res.status(400).json({ error: 'Could not read a transaction hash from that link' });
    }
    const txHash = match[0];

    const { found, reason, from, amountStr } = await verifyTransferOnChain(txHash);

    if (!found) {
      return res.status(200).json({
        success: false,
        status: reason === 'not_found' ? 'pending' : 'mismatch',
        message: reason === 'not_found'
          ? 'المعاملة غير موجودة بعد على السلسلة. انتظر دقيقة وأعد المحاولة.'
          : 'هذه المعاملة لا ترسل USDT إلى محفظتنا. تأكد من أنك نسخت الرابط الصحيح.',
      });
    }

    const expectedCents = Math.round(parseFloat(order.exact_crypto_amount) * 1e6);
    const receivedCents = Math.round(parseFloat(amountStr) * 1e6);

    if (receivedCents !== expectedCents) {
      return res.status(200).json({
        success: false,
        status: 'mismatch',
        message: `المبلغ المرسل (${amountStr} USDT) لا يطابق المبلغ المطلوب (${order.exact_crypto_amount} USDT).`,
      });
    }

    const didComplete = await completePayment(order, txHash, from);
    if (didComplete) await sendReceiptFor(req, order, txHash);
    return res.status(200).json({
      success: true,
      status: 'completed',
      message: 'Payment verified! Access granted.',
      tx_hash: txHash
    });

  } catch (err) {
    console.error('Verify by txlink error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/crypto/check-access
// ---------------------------------------------------------------------------
router.post('/check-access', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const [profileRes, accessRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, role, trial_ends_at, created_at, subscription_active')
        .eq('id', userId)
        .single(),
      supabase
        .from('user_access')
        .select('id, product_id, expires_at, is_active, products(title, type)')
        .eq('user_id', userId)
        .eq('is_active', true),
    ]);

    if (profileRes.error) throw profileRes.error;
    if (accessRes.error) throw accessRes.error;

    const profile = profileRes.data;
    const now = new Date();

    const activeAccess = (accessRes.data || []).filter(a => {
      if (!a.expires_at) return true;
      return new Date(a.expires_at) > now;
    });

    const role = profile && profile.role;
    const isStaff = role === 'admin' || role === 'teacher';
    const hasPaidAccess = activeAccess.length > 0;

    let trialActive = false;
    let trialEnds = null;
    if (profile && profile.trial_ends_at) {
      trialEnds = profile.trial_ends_at;
      trialActive = new Date(trialEnds) > now;
    }

    let status;
    if (isStaff) status = 'staff';
    else if (hasPaidAccess) status = 'paid';
    else if (trialActive) status = 'trial';
    else status = 'locked';

    // Lazy cleanup: unpaid account whose trial ended more than 60 days ago -> delete
    if (!isStaff && !hasPaidAccess && profile) {
      const base = trialEnds ? new Date(trialEnds) : new Date(profile.created_at);
      if (now.getTime() > base.getTime() + GRACE_PERIOD_MS) {
        try {
          await supabase.auth.admin.deleteUser(userId);
          return res.status(200).json({
            status: 'locked',
            deleted: true,
            message: 'هذا الحساب منتهٍ ولم يتم تجديده، تم حذفه.',
          });
        } catch (delErr) {
          console.error('Lazy cleanup delete error:', delErr);
        }
      }
    }

    const trialDaysLeft = trialActive && trialEnds
      ? Math.max(0, Math.ceil((new Date(trialEnds) - now) / (24 * 60 * 60 * 1000)))
      : 0;

    return res.status(200).json({
      status,
      hasAccess: status === 'staff' || status === 'paid' || status === 'trial',
      staff: isStaff,
      trial: {
        active: trialActive,
        ends_at: trialEnds,
        days_left: trialDaysLeft,
      },
      access: activeAccess,
    });

  } catch (err) {
    console.error('Check access error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/crypto/rate (public) — live USDT/DZD Binance P2P rate
// ---------------------------------------------------------------------------
router.get('/rate', async (req, res) => {
  try {
    const rateData = await getDzdRate();
    return res.status(200).json({ ...rateData, age_ms: Date.now() - rateData.fetchedAt });
  } catch (err) {
    return res.status(502).json({ error: 'Rate unavailable', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/crypto/scan (admin) — trigger a wallet scan manually
// ---------------------------------------------------------------------------
router.post('/scan', requireAuth, adminOpsLimiter, requireAdmin, async (req, res) => {
  try {
    const results = await scanOnce();
    return res.status(200).json(results);
  } catch (err) {
    console.error('Manual scan error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/crypto/reconcile-flags (admin) — clear stale subscription_active
// ---------------------------------------------------------------------------
router.post('/reconcile-flags', requireAuth, adminOpsLimiter, requireAdmin, async (req, res) => {
  try {
    const cleared = await reconcileExpiredFlags();
    return res.status(200).json({ cleared });
  } catch (err) {
    console.error('Reconcile flags error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/crypto/incoming-transfers (admin) — reconcile queue
// ---------------------------------------------------------------------------
router.get('/incoming-transfers', requireAuth, adminOpsLimiter, requireAdmin, [
  query('status').optional().isIn(['unmatched', 'matched', 'ignored']).withMessage('Invalid status'),
], async (req, res) => {
  try {
    if (!handleValidation(req, res)) return;
    let q = supabase
      .from('incoming_transfers')
      .select('id, tx_hash, from_address, amount, status, matched_payment_id, detected_at')
      .order('detected_at', { ascending: false })
      .limit(100);
    if (req.query.status) q = q.eq('status', req.query.status);
    const { data, error } = await q;
    if (error) throw error;
    return res.status(200).json(data || []);
  } catch (err) {
    console.error('Fetch incoming transfers error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/crypto/reconcile (admin) — force-complete a payment from a tx hash
// ---------------------------------------------------------------------------
router.post('/reconcile', requireAuth, adminOpsLimiter, requireAdmin, [
  body('paymentId').isUUID().withMessage('Invalid paymentId'),
  body('txHash').matches(/^0x[a-fA-F0-9]{64}$/).withMessage('Invalid tx hash'),
], async (req, res) => {
  try {
    if (!handleValidation(req, res)) return;
    const { paymentId, txHash } = req.body;

    const order = await fetchOrder(paymentId);
    if (!order) return res.status(404).json({ error: 'Payment not found' });
    if (order.status === 'completed') {
      return res.status(200).json({ success: true, message: 'Payment already completed' });
    }

    const { found, reason, from, amountStr } = await verifyTransferOnChain(txHash);
    if (!found) {
      return res.status(400).json({ error: reason === 'not_found' ? 'Transaction not found on chain' : 'No USDT transfer to our wallet in that tx' });
    }

    const expectedCents = Math.round(parseFloat(order.exact_crypto_amount) * 1e6);
    const receivedCents = Math.round(parseFloat(amountStr) * 1e6);
    if (receivedCents !== expectedCents) {
      return res.status(400).json({ error: `Amount mismatch: received ${amountStr} USDT, expected ${order.exact_crypto_amount} USDT` });
    }

    const didComplete = await completePayment(order, txHash, from);
    if (!didComplete) {
      return res.status(200).json({ success: true, message: 'Already completed by another process' });
    }
    if (req.user && req.user.email) await sendReceiptFor(req, order, txHash);

    return res.status(200).json({ success: true, tx_hash: txHash });
  } catch (err) {
    console.error('Reconcile error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/crypto/products (public)
// ---------------------------------------------------------------------------
router.get('/products', async (req, res) => {
  try {
    const { data: products, error } = await supabase
      .from('products')
      .select('id, title, description, type, duration_days, base_price, base_price_dzd, discount_2nd_pct, discount_3rd_pct, max_family_size, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) throw error;
    return res.status(200).json(products || []);
  } catch (err) {
    console.error('Fetch products error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/crypto/products/all (admin)
// ---------------------------------------------------------------------------
router.get('/products/all', requireAuth, adminOpsLimiter, requireAdmin, async (req, res) => {
  try {
    const { data: products, error } = await supabase
      .from('products')
      .select('id, title, description, type, duration_days, base_price, base_price_dzd, discount_2nd_pct, discount_3rd_pct, max_family_size, is_active, sort_order, created_at')
      .order('sort_order', { ascending: true });

    if (error) throw error;
    return res.status(200).json(products || []);
  } catch (err) {
    console.error('Fetch all products error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/crypto/products (admin)
// ---------------------------------------------------------------------------
router.post('/products', requireAuth, adminOpsLimiter, requireAdmin, [
  body('title').isString().isLength({ min: 1, max: 200 }).withMessage('Title required (max 200 chars)'),
  body('type').isIn(['subscription', 'course', 'bundle']).withMessage('Invalid product type'),
  body('base_price').optional({ values: 'falsy' }).isFloat({ min: 0 }).withMessage('base_price must be a positive number'),
  body('base_price_dzd').optional({ values: 'falsy' }).isFloat({ min: 0 }).withMessage('base_price_dzd must be a positive number'),
  body('discount_2nd_pct').optional({ values: 'falsy' }).isFloat({ min: 0, max: 100 }).withMessage('discount 2nd must be 0-100'),
  body('discount_3rd_pct').optional({ values: 'falsy' }).isFloat({ min: 0, max: 100 }).withMessage('discount 3rd must be 0-100'),
  body('max_family_size').optional({ values: 'falsy' }).isInt({ min: 1, max: 10 }).withMessage('max_family_size must be 1-10'),
  body('duration_days').optional({ values: 'falsy' }).isInt({ min: 1, max: 3650 }).withMessage('Duration must be 1-3650 days'),
  body('description').optional().isString().isLength({ max: 2000 }).withMessage('Description max 2000 chars'),
], async (req, res) => {
  try {
    if (!handleValidation(req, res)) return;
    const {
      id, title, description, type, duration_days, base_price, base_price_dzd,
      discount_2nd_pct, discount_3rd_pct, max_family_size, is_active, sort_order,
    } = req.body;

    const payload = {
      title, description, type,
      duration_days: duration_days ?? null,
      base_price: base_price ?? null,
      base_price_dzd: base_price_dzd ?? null,
      discount_2nd_pct: discount_2nd_pct ?? 0,
      discount_3rd_pct: discount_3rd_pct ?? 0,
      max_family_size: max_family_size ?? 1,
      is_active: is_active ?? true,
      sort_order: sort_order ?? 0,
    };

    if (id) {
      const { data, error } = await supabase
        .from('products')
        .update(payload)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return res.status(200).json(data);
    } else {
      const { data, error } = await supabase
        .from('products')
        .insert([payload])
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
router.delete('/products/:id', requireAuth, adminOpsLimiter, requireAdmin, [
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
router.get('/payments', requireAuth, adminOpsLimiter, requireAdmin, [
  query('userId').optional().isUUID().withMessage('Invalid userId'),
  query('status').optional().isIn(['pending', 'completed', 'expired']).withMessage('Invalid status'),
], async (req, res) => {
  try {
    if (!handleValidation(req, res)) return;
    const { userId, status } = req.query;

    let queryBuilder = supabase
      .from('payments')
      .select('id, user_id, product_id, base_amount, base_amount_dzd, exact_crypto_amount, status, payment_source, payer_address, from_address, tx_hash, created_at, expires_at, verified_at, products(title, type)');

    if (userId) queryBuilder = queryBuilder.eq('user_id', userId);
    if (status) queryBuilder = queryBuilder.eq('status', status);

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
