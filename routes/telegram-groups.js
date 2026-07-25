require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// GET /api/telegram-groups
// Public — returns active groups, optionally filtered by ?role=student
router.get('/', async (req, res) => {
  try {
    const { role } = req.query;

    let query = supabase
      .from('telegram_groups')
      .select('*')
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
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/telegram-groups/all
// Admin — returns all groups including inactive
router.get('/all', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('telegram_groups')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false });

    if (error) throw error;

    return res.status(200).json(data || []);
  } catch (err) {
    console.error('List all telegram groups error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/telegram-groups
// Admin — create a new group
router.post('/', async (req, res) => {
  try {
    const { name, role, invite_link, grade_level, description, sort_order } = req.body;

    if (!name || !role || !invite_link) {
      return res.status(400).json({ error: 'name, role, and invite_link are required' });
    }

    const validRoles = ['student', 'teacher', 'parent', 'admin', 'all'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${validRoles.join(', ')}` });
    }

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
    return res.status(500).json({ error: err.message });
  }
});

// PUT /api/telegram-groups/:id
// Admin — update a group
router.put('/:id', async (req, res) => {
  try {
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
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/telegram-groups/:id
// Admin — delete a group
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('telegram_groups')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return res.status(200).json({ message: 'Group deleted' });
  } catch (err) {
    console.error('Delete telegram group error:', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
