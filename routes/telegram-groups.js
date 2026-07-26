require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { body, param, validationResult } = require('express-validator');
const { requireAuth, requireTeacherOrAdmin } = require('../middleware/supabase');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Invalid input', details: errors.array().map(e => e.msg) });
  }
}

// GET /api/telegram-groups (public — active groups)
router.get('/', async (req, res) => {
  try {
    const { role } = req.query;

    let query = supabase
      .from('telegram_groups')
      .select('id, name, role, invite_link, grade_level, description, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false });

    if (role) {
      query = query.or(`role.eq.${role},role.eq.all`);
    }

    const { data, error } = await query;
    if (error) throw error;

    return res.status(200).json(data || []);
  } catch (err) {
    console.error('List telegram groups error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/telegram-groups/all (admin)
router.get('/all', requireAuth, requireTeacherOrAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('telegram_groups')
      .select('id, name, role, invite_link, grade_level, description, is_active, sort_order, created_at')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false });

    if (error) throw error;

    return res.status(200).json(data || []);
  } catch (err) {
    console.error('List all telegram groups error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/telegram-groups (admin)
router.post('/', requireAuth, requireTeacherOrAdmin, [
  body('name').isString().isLength({ min: 1, max: 200 }).withMessage('Name required (max 200 chars)'),
  body('role').isIn(['student', 'teacher', 'parent', 'admin', 'all']).withMessage('Invalid role'),
  body('invite_link').isURL().withMessage('Invalid invite link URL'),
  body('description').optional().isString().isLength({ max: 1000 }).withMessage('Description max 1000 chars'),
  body('grade_level').optional().isString().isLength({ max: 50 }).withMessage('Grade level max 50 chars'),
  body('sort_order').optional().isInt({ min: 0, max: 9999 }).withMessage('sort_order must be 0-9999'),
], async (req, res) => {
  try {
    if (!handleValidation(req, res)) return;
    const { name, role, invite_link, grade_level, description, sort_order } = req.body;

    const { data, error } = await supabase
      .from('telegram_groups')
      .insert([{
        name,
        role,
        invite_link,
        grade_level: grade_level || null,
        description: description || null,
        sort_order: sort_order || 0,
      }])
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json(data);
  } catch (err) {
    console.error('Create telegram group error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/telegram-groups/:id (admin)
router.put('/:id', requireAuth, requireTeacherOrAdmin, [
  param('id').isUUID().withMessage('Invalid group ID'),
  body('name').optional().isString().isLength({ min: 1, max: 200 }).withMessage('Name max 200 chars'),
  body('role').optional().isIn(['student', 'teacher', 'parent', 'admin', 'all']).withMessage('Invalid role'),
  body('invite_link').optional().isURL().withMessage('Invalid invite link URL'),
  body('description').optional().isString().isLength({ max: 1000 }).withMessage('Description max 1000 chars'),
  body('grade_level').optional().isString().isLength({ max: 50 }).withMessage('Grade level max 50 chars'),
  body('sort_order').optional().isInt({ min: 0, max: 9999 }).withMessage('sort_order must be 0-9999'),
  body('is_active').optional().isBoolean().withMessage('is_active must be boolean'),
], async (req, res) => {
  try {
    if (!handleValidation(req, res)) return;
    const { id } = req.params;
    const { name, role, invite_link, grade_level, description, is_active, sort_order } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (role !== undefined) updates.role = role;
    if (invite_link !== undefined) updates.invite_link = invite_link;
    if (grade_level !== undefined) updates.grade_level = grade_level;
    if (description !== undefined) updates.description = description;
    if (is_active !== undefined) updates.is_active = is_active;
    if (sort_order !== undefined) updates.sort_order = sort_order;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const { data, error } = await supabase
      .from('telegram_groups')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json(data);
  } catch (err) {
    console.error('Update telegram group error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/telegram-groups/:id (admin)
router.delete('/:id', requireAuth, requireTeacherOrAdmin, [
  param('id').isUUID().withMessage('Invalid group ID'),
], async (req, res) => {
  try {
    if (!handleValidation(req, res)) return;
    const { id } = req.params;

    const { error } = await supabase
      .from('telegram_groups')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return res.status(200).json({ message: 'Group deleted' });
  } catch (err) {
    console.error('Delete telegram group error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
