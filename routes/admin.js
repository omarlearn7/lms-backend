const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const { requireAuth, requireAdmin } = require('../middleware/supabase');

const GRACE_PERIOD_MS = 60 * 24 * 60 * 60 * 1000; // 60 days after trial ends

async function listAllAuthUsers() {
  const all = [];
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    if (!data || !data.users || data.users.length === 0) break;
    all.push(...data.users);
    if (data.users.length < perPage) break;
    page += 1;
  }
  return all;
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvLine(fields) {
  return fields.map(csvEscape).join(',');
}

function accountStatus(profile, activeAccessByUser, now) {
  if (profile.role === 'admin' || profile.role === 'teacher') return 'staff';
  if (activeAccessByUser[profile.id]) return 'paid';
  if (profile.trial_ends_at && new Date(profile.trial_ends_at) > now) return 'trial';
  return 'locked';
}

// POST /api/admin/create-user (admin) — manually create any account (student/teacher/parent/admin)
router.post('/create-user', requireAuth, requireAdmin, async (req, res) => {
  try {
    const {
      role, first_name, last_name, email, password,
      grade_level, phone, country, parent_id, teaching_subject,
      trial_days,
    } = req.body || {};

    const allowedRoles = ['student', 'teacher', 'parent', 'admin'];
    const normalizedRole = String(role || 'student').toLowerCase();
    if (!allowedRoles.includes(normalizedRole)) {
      return res.status(400).json({ error: 'Invalid role. Must be one of: student, teacher, parent, admin.' });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
      return res.status(400).json({ error: 'A valid email is required.' });
    }
    if (normalizedRole === 'student' && !grade_level) {
      return res.status(400).json({ error: 'grade_level is required for student accounts.' });
    }

    const generatedPassword = password && password.length >= 8
      ? password
      : Array.from({ length: 12 }, () => {
          const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
          return chars[Math.floor(Math.random() * chars.length)];
        }).join('');

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password: generatedPassword,
      email_confirm: true,
      user_metadata: {
        first_name: first_name || '',
        last_name: last_name || '',
        role: normalizedRole,
      },
    });

    if (authError) {
      return res.status(400).json({ error: authError.message });
    }

    const trialEndsAt = trial_days && Number(trial_days) > 0
      ? new Date(Date.now() + Number(trial_days) * 24 * 60 * 60 * 1000).toISOString()
      : null;

    const profileRow = {
      id: authData.user.id,
      role: normalizedRole,
      first_name: first_name || '',
      last_name: last_name || '',
      country: country || 'dz',
      subscription_active: !!trialEndsAt,
    };
    if (normalizedRole === 'student') {
      profileRow.grade_level = grade_level;
      if (parent_id) profileRow.parent_id = parent_id;
    }
    if (normalizedRole === 'parent') profileRow.parent_type = 'أب';
    if (normalizedRole === 'teacher' && teaching_subject) profileRow.teaching_subject = teaching_subject;
    if (phone) profileRow.phone = phone;
    if (trialEndsAt) profileRow.trial_ends_at = trialEndsAt;

    const { error: profileError } = await supabase
      .from('profiles')
      .upsert([profileRow]);

    if (profileError) {
      console.error('Profile creation error:', profileError);
      return res.status(500).json({ error: 'Account created but profile failed: ' + profileError.message });
    }

    return res.status(201).json({
      message: 'Account created successfully.',
      userId: authData.user.id,
      email: authData.user.email,
      password: generatedPassword,
      trial_ends_at: trialEndsAt,
    });
  } catch (err) {
    console.error('Create user error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/export-users (admin) — CSV of all contacts for campaigns
router.get('/export-users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [profilesRes, accessRes, authUsers] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, first_name, last_name, role, grade_level, phone, telegram_id, country, created_at, trial_ends_at, subscription_active'),
      supabase
        .from('user_access')
        .select('user_id, expires_at')
        .eq('is_active', true),
      listAllAuthUsers(),
    ]);

    if (profilesRes.error) throw profilesRes.error;
    if (accessRes.error) throw accessRes.error;

    const now = new Date();
    const emailById = {};
    for (const u of authUsers) {
      emailById[u.id] = u.email || u.phone || '';
    }

    const activeAccessByUser = {};
    for (const a of accessRes.data || []) {
      if (!a.expires_at || new Date(a.expires_at) > now) activeAccessByUser[a.user_id] = true;
    }

    const header = csvLine([
      'email', 'first_name', 'last_name', 'phone', 'telegram_id', 'country',
      'role', 'grade_level', 'status', 'created_at', 'trial_ends_at', 'subscription_active',
    ]);

    const rows = (profilesRes.data || []).map(p => csvLine([
      emailById[p.id] || '',
      p.first_name,
      p.last_name,
      p.phone,
      p.telegram_id,
      p.country,
      p.role,
      p.grade_level,
      accountStatus(p, activeAccessByUser, now),
      p.created_at,
      p.trial_ends_at,
      p.subscription_active,
    ]));

    const csv = '\uFEFF' + [header, ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="contacts.csv"');
    return res.status(200).send(csv);
  } catch (err) {
    console.error('Export users error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/cleanup-expired (admin) — delete accounts past trial + 60-day grace, unpaid
router.post('/cleanup-expired', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [profilesRes, accessRes] = await Promise.all([
      supabase.from('profiles').select('id, role, trial_ends_at, created_at'),
      supabase.from('user_access').select('user_id, expires_at').eq('is_active', true),
    ]);

    if (profilesRes.error) throw profilesRes.error;
    if (accessRes.error) throw accessRes.error;

    const now = new Date();
    const nowMs = now.getTime();
    const paid = new Set();
    for (const a of accessRes.data || []) {
      if (!a.expires_at || new Date(a.expires_at).getTime() > nowMs) paid.add(a.user_id);
    }

    const toDelete = (profilesRes.data || []).filter(p => {
      if (p.role === 'admin' || p.role === 'teacher') return false;
      if (paid.has(p.id)) return false;
      const base = p.trial_ends_at ? new Date(p.trial_ends_at) : new Date(p.created_at);
      return nowMs > base.getTime() + GRACE_PERIOD_MS;
    });

    let deleted = 0;
    const failed = [];
    for (const p of toDelete) {
      try {
        await supabase.auth.admin.deleteUser(p.id);
        deleted += 1;
      } catch (err) {
        console.error('Cleanup delete failed for', p.id, err.message);
        failed.push(p.id);
      }
    }

    return res.status(200).json({
      scanned: profilesRes.data ? profilesRes.data.length : 0,
      deleted,
      failed,
    });
  } catch (err) {
    console.error('Cleanup error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
