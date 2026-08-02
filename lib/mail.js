require('dotenv').config();
const nodemailer = require('nodemailer');

const FROM_EMAIL = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@example.com';
const FROM_NAME = process.env.SMTP_FROM_NAME || 'منصة التعليم';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('[mail] SMTP not configured; emails will be skipped.');
    return null;
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: (process.env.SMTP_SECURE || 'false') === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
}

function baseLayout(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#1e293b;border:1px solid #334155;border-radius:12px;overflow:hidden;">
<tr><td style="background:linear-gradient(135deg,#1d4ed8,#7c3aed);padding:22px 28px;">
<div style="color:#ffffff;font-size:20px;font-weight:700;">${title}</div>
</td></tr>
<tr><td style="padding:28px;color:#e2e8f0;font-size:15px;line-height:1.9;">
${bodyHtml}
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #334155;color:#64748b;font-size:12px;text-align:center;">
${FROM_NAME} — تم إرسال هذه الرسالة تلقائيًا، يرجى عدم الرد عليها.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function sendMail(to, subject, html) {
  const t = getTransporter();
  if (!t) {
    console.warn('[mail] Skipping email to', to, ':', subject);
    return Promise.resolve(false);
  }
  return t.sendMail({
    from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
    to,
    subject,
    html,
  }).then(() => true).catch((err) => {
    console.error('[mail] send error:', err.message);
    return false;
  });
}

function fmtAmount(amount, currency) {
  const sym = currency === 'USDT' ? 'USDT' : currency === 'DZD' ? 'دج' : currency || 'USDT';
  return `${Number(amount).toFixed(2)} ${sym}`;
}

async function sendReceipt({ to, amount, currency = 'USDT', txId, productTitle, date, paymentSource }) {
  const bodyHtml = `
<div style="font-size:17px;font-weight:700;color:#86efac;">تم تأكيد الدفع بنجاح 🎉</div>
<div style="margin-top:14px;">مرحبًا، تم تفعيل اشتراكك في المنصة. إليك تفاصيل عملية الدفع:</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;background:#0f172a;border:1px solid #334155;border-radius:8px;">
<tr><td style="padding:14px 18px;color:#94a3b8;font-size:13px;">المنتج</td><td style="padding:14px 18px;color:#e2e8f0;font-weight:600;text-align:left;">${productTitle || '—'}</td></tr>
<tr><td style="padding:14px 18px;border-top:1px solid #334155;color:#94a3b8;font-size:13px;">المبلغ</td><td style="padding:14px 18px;border-top:1px solid #334155;color:#fbbf24;font-weight:700;text-align:left;">${fmtAmount(amount, currency)}</td></tr>
<tr><td style="padding:14px 18px;border-top:1px solid #334155;color:#94a3b8;font-size:13px;">طريقة الدفع</td><td style="padding:14px 18px;border-top:1px solid #334155;color:#e2e8f0;text-align:left;">${paymentSource === 'binance' ? 'Binance Pay (USDT)' : 'محفظة Web3 (USDT/BEP-20)'}</td></tr>
<tr><td style="padding:14px 18px;border-top:1px solid #334155;color:#94a3b8;font-size:13px;">معرّف العملية</td><td style="padding:14px 18px;border-top:1px solid #334155;color:#94a3b8;font-size:12px;direction:ltr;text-align:left;word-break:break-all;">${txId || '—'}</td></tr>
<tr><td style="padding:14px 18px;border-top:1px solid #334155;color:#94a3b8;font-size:13px;">التاريخ</td><td style="padding:14px 18px;border-top:1px solid #334155;color:#e2e8f0;text-align:left;">${date || ''}</td></tr>
</table>
<div style="margin-top:18px;color:#94a3b8;font-size:13px;">يمكنك الآن الدخول إلى حسابك والاستفادة من المحتوى المشترك. إذا واجهت أي مشكلة، تواصل معنا عبر قناة التلغرام.</div>`;
  return sendMail(to, 'تأكيد الدفع — تفعيل الاشتراك', baseLayout('✅ تأكيد الدفع', bodyHtml));
}

module.exports = { sendMail, sendReceipt, getTransporter };
