// lib/payment-scanner.js
// Background wallet scanner that auto-verifies USDT (BEP-20) payments.
//
// Attribution is sender-based, not amount-based:
//   - Each invoice binds the payer's sending wallet address (payer_address).
//   - A transfer is matched when `from == payer_address` AND the amount matches
//     the invoice. Even if many users send the SAME amount at the same time,
//     their different wallets disambiguate them.
//   - tx_hash is globally UNIQUE in the DB, so one on-chain tx can complete
//     exactly one invoice, ever (no double-claim, no mistakes).
//   - Every incoming transfer is also logged to `incoming_transfers` so unmatched
//     payments land in an admin reconcile queue instead of being silently lost.

const { ethers } = require('ethers');
const { createClient } = require('@supabase/supabase-js');
const { getProvider } = require('./bsc-rpc');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const USDT_BSC_ADDRESS = '0x55d398326f99059fF775485246999027B3197955';
const RECEIVER_WALLET = process.env.MY_PERSONAL_RECEIVING_WALLET;

const ERC20_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

// Cold start scans a window instead of from block 0.
const COLD_START_WINDOW_BLOCKS = 1200;
const DEFAULT_SCAN_WINDOW_BLOCKS = 500;
const LOG_CHUNK_BLOCKS = 200; // public BSC RPC rate-limits large eth_getLogs ranges
const MAX_CHUNK_RETRIES = 3;

let scanning = false;
let lastScannedBlock = 0;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Fetch USDT Transfer logs to the platform wallet over a block range.
 * Chunks the range (public BSC RPC throttles big eth_getLogs ranges) and
 * retries chunk failures with backoff.
 */
async function fetchIncomingTransfers(provider, contract, fromBlock, toBlock) {
  const logs = [];
  let chunkStart = fromBlock;
  while (chunkStart <= toBlock) {
    const chunkEnd = Math.min(chunkStart + LOG_CHUNK_BLOCKS - 1, toBlock);
    let attempts = 0;
    while (true) {
      try {
        const chunk = await contract.queryFilter(
          contract.filters.Transfer(null, RECEIVER_WALLET),
          chunkStart,
          chunkEnd
        );
        logs.push(...chunk);
        break;
      } catch (err) {
        attempts++;
        if (attempts >= MAX_CHUNK_RETRIES) throw err;
        await sleep(1000 * attempts); // backoff: 1s, 2s, 3s
      }
    }
    chunkStart = chunkEnd + 1;
  }
  return logs;
}

function sameAddress(a, b) {
  if (!a || !b) return false;
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function amountsMatch(amountStr, expectedStr) {
  return (
    Math.round(parseFloat(amountStr) * 1e6) ===
    Math.round(parseFloat(expectedStr) * 1e6)
  );
}

/**
 * Grant access for a completed payment. Also propagates the grant to any
 * children linked to a parent payer (family plans).
 */
async function grantAccess(order) {
  let expiresAt = null;
  const product = Array.isArray(order.products) ? order.products[0] : order.products;
  if (product && product.type === 'subscription' && product.duration_days) {
    const exp = new Date();
    exp.setDate(exp.getDate() + product.duration_days);
    expiresAt = exp.toISOString();
  }

  const rows = [{
    user_id: order.user_id,
    product_id: order.product_id,
    expires_at: expiresAt,
    is_active: true,
  }];

  // Family propagation: if the payer is a parent, cover linked children too.
  // family_size on the invoice caps how many students this payment covers
  // (1 = individual, so only the payer). Older invoices without family_size
  // keep the legacy behaviour and cover every linked child.
  try {
    const { data: children } = await supabase
      .from('profiles')
      .select('id')
      .eq('parent_id', order.user_id)
      .eq('role', 'student')
      .order('created_at', { ascending: true });

    if (children && children.length) {
      const familySize = order.family_size || 1;
      const covered = familySize > 1 ? children.slice(0, familySize - 1) : [];
      for (const child of covered) {
        rows.push({
          user_id: child.id,
          product_id: order.product_id,
          expires_at: expiresAt,
          is_active: true,
        });
      }
    }
  } catch (err) {
    console.error('[payment-scanner] family propagation error:', err);
  }

  if (rows.length) {
    await supabase.from('user_access').insert(rows);
  }
  await supabase
    .from('profiles')
    .update({ subscription_active: true })
    .eq('id', order.user_id);
}

/**
 * Atomically complete a pending invoice and grant access.
 * Returns true if THIS call performed the completion.
 */
async function completePayment(order, txHash, fromAddress) {
  const { data, error } = await supabase
    .from('payments')
    .update({
      status: 'completed',
      tx_hash: txHash,
      from_address: fromAddress,
      verified_at: new Date().toISOString(),
    })
    .eq('id', order.id)
    .eq('status', 'pending')
    .select('id')
    .single();

  if (error) throw error;
  if (!data) return false; // already completed by a concurrent process

  await grantAccess(order);
  return true;
}

/**
 * Match a pending invoice against an on-chain transfer.
 * Primary: sender == payer_address AND amount matches.
 */
function matchOrderToTransfer(order, fromAddress, amountStr) {
  if (!order || order.status !== 'pending') return false;
  if (new Date(order.expires_at) < new Date()) return false;
  if (!amountsMatch(amountStr, order.exact_crypto_amount)) return false;
  if (order.payer_address && !sameAddress(order.payer_address, fromAddress)) return false;
  return true;
}

/** Scan recent incoming USDT transfers and auto-complete matching invoices. */
async function scanOnce() {
  if (scanning) return { skipped: true };
  scanning = true;
  const startedAt = Date.now();
  const results = { scanned: 0, matched: 0, unmatched: 0, errors: 0 };

  try {
    if (!RECEIVER_WALLET) return results;

    const provider = await getProvider();
    const contract = new ethers.Contract(USDT_BSC_ADDRESS, ERC20_ABI, provider);

    const latestBlock = await provider.getBlockNumber();
    const windowBlocks = lastScannedBlock > 0 ? DEFAULT_SCAN_WINDOW_BLOCKS : COLD_START_WINDOW_BLOCKS;
    const fromBlock = lastScannedBlock > 0
      ? lastScannedBlock + 1
      : Math.max(latestBlock - windowBlocks, 0);
    const toBlock = latestBlock;

    if (fromBlock > toBlock) {
      lastScannedBlock = toBlock;
      return results;
    }

    const filter = contract.filters.Transfer(null, RECEIVER_WALLET);
    const logs = await fetchIncomingTransfers(provider, contract, fromBlock, toBlock);
    lastScannedBlock = toBlock;
    results.scanned = logs.length;

    if (!logs.length) return results;

    const { data: pending, error: pErr } = await supabase
      .from('payments')
      .select('id, user_id, product_id, exact_crypto_amount, payer_address, status, expires_at, family_size, products(title, type, duration_days)')
      .eq('status', 'pending');
    if (pErr) throw pErr;

    const pendingOrders = pending || [];

    for (const log of logs) {
      const txHash = log.transactionHash;
      const fromAddress = log.args.from;
      const amountStr = ethers.formatUnits(log.args.value, 18);

      // Record the transfer (idempotent by unique tx_hash).
      const { data: existing } = await supabase
        .from('incoming_transfers')
        .select('id, status, matched_payment_id')
        .eq('tx_hash', txHash)
        .maybeSingle();

      if (!existing) {
        await supabase.from('incoming_transfers').insert([{
          tx_hash: txHash,
          from_address: fromAddress,
          amount: parseFloat(amountStr),
          status: 'unmatched',
        }]);
      }

      // Prefer sender-bound match; fall back to amount match only when the
      // invoice has NO payer_address bound (legacy invoices).
      const bound = pendingOrders.find(o => matchOrderToTransfer(o, fromAddress, amountStr));
      const legacy = !bound ? pendingOrders.find(o =>
        !o.payer_address && matchOrderToTransfer(o, fromAddress, amountStr)
      ) : null;
      const match = bound || legacy;

      if (match) {
        const didComplete = await completePayment(match, txHash, fromAddress);
        if (didComplete) {
          results.matched++;
          await supabase
            .from('incoming_transfers')
            .update({ status: 'matched', matched_payment_id: match.id })
            .eq('tx_hash', txHash);
        }
      } else {
        results.unmatched++;
      }
    }
  } catch (err) {
    console.error('[payment-scanner] scan error:', err);
    results.errors++;
  } finally {
    scanning = false;
    results.durationMs = Date.now() - startedAt;
  }
  return results;
}

/** Clear stale subscription_active flags where no active user_access remains. */
async function reconcileExpiredFlags() {
  try {
    const { data: users } = await supabase
      .from('profiles')
      .select('id')
      .eq('subscription_active', true);
    if (!users || !users.length) return 0;

    let cleared = 0;
    const now = new Date().toISOString();
    for (const u of users) {
      const { data: active } = await supabase
        .from('user_access')
        .select('id')
        .eq('user_id', u.id)
        .eq('is_active', true)
        .is('expires_at', null)
        .or(`expires_at.gt.${now}`);
      if (!active || active.length === 0) {
        await supabase.from('profiles').update({ subscription_active: false }).eq('id', u.id);
        cleared++;
      }
    }
    return cleared;
  } catch (err) {
    console.error('[payment-scanner] reconcile flags error:', err);
    return 0;
  }
}

/**
 * Start the background scanner.
 * @param {number} intervalMs
 */
function startScanner(intervalMs = 60 * 1000) {
  if (!RECEIVER_WALLET) {
    console.warn('[payment-scanner] MY_PERSONAL_RECEIVING_WALLET not set; scanner disabled.');
    return null;
  }
  const timer = setInterval(() => {
    scanOnce().catch((err) => console.error('[payment-scanner] interval error:', err));
  }, intervalMs);
  if (timer.unref) timer.unref();

  // First scan shortly after boot.
  setTimeout(() => {
    scanOnce().catch((err) => console.error('[payment-scanner] boot scan error:', err));
  }, 3000);

  console.log(`[payment-scanner] started (every ${intervalMs}ms)`);
  return timer;
}

module.exports = { scanOnce, startScanner, reconcileExpiredFlags, completePayment, grantAccess, fetchIncomingTransfers };
