// routes/family.js
// Family wizard endpoints for parent accounts.
//   GET  /api/family/children   -> real linked children + access status
//   POST /api/family/add-child  -> create a confirmed student account linked to the parent
//   POST /api/family/link-child -> link an existing student account by email
const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const { requireAuth } = require('../middleware/supabase');
const rateLimit = require('express-rate-limit');

const familyWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many family operations. Try again later.' },
});

const GRADE_LEVELS = ['grade_1', 'grade_2', 'grade_3', 'grade_4'];
const HARD_CHILD_CAP = 10;

const VALID_CHILD_KEYS = {
  grade_1: 'سنة أولى ثانوي',
  grade_2: 'سنة ثانية ثانوي',
  grade_3: 'سنة ثالثة ثانوي (BAC)',
  grade_4: 'سنة رابعة متوسط',
};

function generatePassword(len = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// Parent-only guard (fetches the caller's profile role from the DB).
async function requireParent(req, res, next) {
  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, role')
      .eq('id', req.user.id)
      .single();

    if (error || !profile) return res.status(403).json({ error: 'Profile not found' });
    if (profile.role !== 'parent') return res.status(403).json({ error: 'Parent account required' });
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error checking role' });
  }
}

// GET /api/family/children
router.get('/children', requireAuth, requireParent, async (req, res) => {
  try {
    const parentId = req.user.id;

    const [childrenRes, accessRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, first_name, last_name, grade_level, trial_ends_at, created_at, subscription_active')
        .eq('parent_id', parentId)
        .eq('role', 'student')
        .order('created_at', { ascending: true }),
      supabase
        .from('user_access')
        .select('user_id, expires_at, products(title, type)')
        .eq('is_active', true),
    ]);

    if (childrenRes.error) throw childrenRes.error;
    if (accessRes.error) throw accessRes.error;

    const now = new Date();
    const accessByUser = {};
    for (const a of accessRes.data || []) {
      if (!a.expires_at || new Date(a.expires_at) > now) accessByUser[a.user_id] = a;
    }

    const children = (childrenRes.data || []).map((c) => {
      let status = 'locked';
      if (accessByUser[c.id]) status = 'paid';
      else if (c.trial_ends_at && new Date(c.trial_ends_at) > now) status = 'trial';

      return {
        id: c.id,
        first_name: c.first_name,
        last_name: c.last_name,
        grade_level: c.grade_level,
        grade_label: VALID_CHILD_KEYS[c.grade_level] || c.grade_level || '—',
        status,
        subscription_active: c.subscription_active,
        product_title: accessByUser[c.id]?.products?.[0]?.title || null,
        expires_at: accessByUser[c.id]?.expires_at || null,
        created_at: c.created_at,
      };
    });

    return res.status(200).json({ children });
  } catch (err) {
    console.error('[family] list children error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/family/add-child — create a new student account linked to this parent.
router.post('/add-child', requireAuth, requireParent, familyWriteLimiter, async (req, res) => {
  try {
    const { first_name, last_name, grade_level, email } = req.body || {};

    if (!first_name || !String(first_name).trim()) return res.status(400).json({ error: 'Child first name is required.' });
    if (!last_name || !String(last_name).trim()) return res.status(400).json({ error: 'Child last name is required.' });
    if (!GRADE_LEVELS.includes(grade_level)) return res.status(400).json({ error: 'Invalid grade level.' });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
      return res.status(400).json({ error: 'A valid email is required for the child account.' });
    }

    // Enforce a hard cap on the number of linked children.
    const { data: existingChildren, error: capErr } = await supabase
      .from('profiles')
      .select('id')
      .eq('parent_id', req.user.id)
      .eq('role', 'student');
    if (capErr) throw capErr;
    if ((existingChildren || []).length >= HARD_CHILD_CAP) {
      return res.status(400).json({ error: `Maximum ${HARD_CHILD_CAP} children per family.` });
    }

    const password = generatePassword();

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: String(email).trim().toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: {
        first_name: String(first_name).trim(),
        last_name: String(last_name).trim(),
        role: 'student',
        grade_level,
      },
    });

    if (authError) {
      // Friendly message for duplicate email.
      if (/already registered|duplicate/i.test(authError.message)) {
        return res.status(409).json({ error: 'هذا البريد مسجّل مسبقاً. استخدم رابط طفل آخر أو وظيفة الربط.' });
      }
      return res.status(400).json({ error: authError.message });
    }

    const { error: profileError } = await supabase
      .from('profiles')
      .upsert([{
        id: authData.user.id,
        role: 'student',
        first_name: String(first_name).trim(),
        last_name: String(last_name).trim(),
        grade_level,
        parent_id: req.user.id,
        country: 'dz',
        subscription_active: false,
      }]);

    if (profileError) {
      console.error('[family] add-child profile error:', profileError);
      return res.status(500).json({ error: 'Child created but profile failed: ' + profileError.message });
    }

    return res.status(201).json({
      message: 'Child account created successfully.',
      child: {
        id: authData.user.id,
        first_name: String(first_name).trim(),
        last_name: String(last_name).trim(),
        grade_level,
        grade_label: VALID_CHILD_KEYS[grade_level] || grade_level,
      },
      email: authData.user.email,
      password,
    });
  } catch (err) {
    console.error('[family] add-child error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/family/link-child — attach an existing student to this parent by email.
router.post('/link-child', requireAuth, requireParent, familyWriteLimiter, async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
      return res.status(400).json({ error: 'A valid email is required.' });
    }

    const { data: userList, error: listError } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (listError) throw listError;

    const target = (userList.users || []).find(
      (u) => String(u.email || '').toLowerCase() === String(email).trim().toLowerCase()
    );

    if (!target) {
      return res.status(404).json({ error: 'لم يتم العثور على حساب بهذا البريد.' });
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, role, first_name, last_name, parent_id')
      .eq('id', target.id)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({ error: 'الحساب موجود لكن ملفه الدراسي غير مكتمل.' });
    }
    if (profile.role !== 'student') {
      return res.status(400).json({ error: 'هذا الحساب ليس حساب طالب.' });
    }
    if (profile.parent_id && profile.parent_id !== req.user.id) {
      return res.status(400).json({ error: 'هذا الطالب مرتبط بعائلة أخرى.' });
    }

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ parent_id: req.user.id })
      .eq('id', target.id);
    if (updateError) throw updateError;

    return res.status(200).json({
      message: 'Child linked successfully.',
      child: {
        id: target.id,
        first_name: profile.first_name,
        last_name: profile.last_name,
        grade_level: profile.grade_level,
      },
    });
  } catch (err) {
    console.error('[family] link-child error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
