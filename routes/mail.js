const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/supabase');
const { sendReceipt } = require('../lib/mail');

// POST /api/mail/test-receipt (admin)
// Sends a sample payment receipt to the given email (defaults to the admin's own).
router.post('/test-receipt', requireAuth, requireAdmin, async (req, res) => {
  try {
    const to = req.body.email || req.user.email;
    if (!to) return res.status(400).json({ error: 'No recipient email' });

    const sent = await sendReceipt({
      to,
      amount: req.body.amount || 19.5,
      currency: 'USDT',
      txId: req.body.txId || '0xTEST' + Date.now().toString(16).slice(-8),
      productTitle: req.body.productTitle || 'رسالة اختبارية — تأكيد دفع (USDT وهمي)',
      date: new Date().toLocaleString('fr-FR'),
      paymentSource: req.body.paymentSource === 'binance' ? 'binance' : 'web3',
    });

    if (!sent) {
      return res.status(500).json({ error: 'Email could not be sent (SMTP not configured?)' });
    }

    return res.status(200).json({ success: true, to });
  } catch (err) {
    console.error('Test receipt error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
