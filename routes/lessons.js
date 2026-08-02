require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { body, param, query, validationResult } = require('express-validator');
const { requireAuth, requireTeacherOrAdmin } = require('../middleware/supabase');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// lessons.grade_level stores Arabic display labels while profiles/units use codes
const GRADE_LABELS = {
  grade_1: 'سنة أولى ثانوي',
  grade_2: 'سنة ثانية ثانوي',
  grade_3: 'سنة ثالثة ثانوي',
  grade_4: 'سنة رابعة متوسط',
};

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Invalid input', details: errors.array().map(e => e.msg) });
  }
}

function slugify(text) {
  return text
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

// GET /api/lessons - list lessons (paginated, filterable)
router.get('/', requireAuth, [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be >= 1'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be 1-50'),
  query('category').optional().isString().isLength({ max: 100 }),
  query('grade').optional().isString().isLength({ max: 50 }),
  query('search').optional().isString().isLength({ max: 200 }),
], async (req, res) => {
  try {
    if (!handleValidation(req, res)) return;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 12;
    const offset = (page - 1) * limit;
    const { category, grade, search } = req.query;

    let countQuery = supabase.from('lessons').select('id', { count: 'exact', head: true });
    let dataQuery = supabase
      .from('lessons')
      .select('id, title, slug, description, category_id, grade_level, order_index, is_free, thumbnail_url, created_by, created_at, updated_at');

    if (category) {
      countQuery = countQuery.eq('grade_level', category);
      dataQuery = dataQuery.eq('grade_level', category);
    }
    if (grade) {
      const gradeLabel = GRADE_LABELS[grade] || grade;
      countQuery = countQuery.eq('grade_level', gradeLabel);
      dataQuery = dataQuery.eq('grade_level', gradeLabel);
    }
    if (search) {
      countQuery = countQuery.ilike('title', `%${search}%`);
      dataQuery = dataQuery.ilike('title', `%${search}%`);
    }

    const { count, error: countError } = await countQuery;
    if (countError) throw countError;

    const { data, error } = await dataQuery
      .order('order_index', { ascending: true })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return res.status(200).json({
      lessons: data || [],
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    });
  } catch (err) {
    console.error('List lessons error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/lessons/my-progress - get current user's progress for all lessons
router.get('/my-progress', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('lesson_progress')
      .select('lesson_id, completed_blocks, completed_at')
      .eq('user_id', req.user.id);

    if (error) throw error;
    return res.status(200).json(data || []);
  } catch (err) {
    console.error('Get progress error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/lessons/:slug - get single lesson with full content
router.get('/:slug', requireAuth, [
  param('slug').isString().isLength({ min: 1, max: 255 }),
], async (req, res) => {
  try {
    if (!handleValidation(req, res)) return;

    const { data: lesson, error } = await supabase
      .from('lessons')
      .select('id, title, slug, description, category_id, grade_level, order_index, is_free, content_json, thumbnail_url, created_by, created_at, updated_at')
      .eq('slug', req.params.slug)
      .single();

    if (error || !lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    if (!lesson.is_free) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('subscription_active, role')
        .eq('id', req.user.id)
        .single();

      if (profile && !profile.subscription_active && !['admin', 'teacher'].includes(profile.role)) {
        return res.status(403).json({ error: 'Subscription required' });
      }
    }

    const { data: progress } = await supabase
      .from('lesson_progress')
      .select('completed_blocks, completed_at')
      .eq('user_id', req.user.id)
      .eq('lesson_id', lesson.id)
      .single();

    return res.status(200).json({
      ...lesson,
      user_progress: progress || { completed_blocks: [], completed_at: null },
    });
  } catch (err) {
    console.error('Get lesson error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/lessons - create lesson (teacher/admin)
router.post('/', requireAuth, requireTeacherOrAdmin, [
  body('title').isString().isLength({ min: 1, max: 255 }).withMessage('Title required'),
  body('content_json').isObject().withMessage('content_json required'),
  body('category_id').optional({ nullable: true }).isInt().withMessage('Invalid category_id'),
  body('grade_level').optional().isString().isLength({ max: 50 }),
  body('order_index').optional().isInt({ min: 0 }),
  body('is_free').optional().isBoolean(),
  body('description').optional().isString().isLength({ max: 1000 }),
  body('thumbnail_url').optional().isString().isLength({ max: 500 }),
], async (req, res) => {
  try {
    if (!handleValidation(req, res)) return;

    const { title, content_json, category_id, grade_level, order_index, is_free, description, thumbnail_url } = req.body;

    let slug = slugify(title);
    const { data: existing } = await supabase.from('lessons').select('id').eq('slug', slug).single();
    if (existing) {
      slug = `${slug}-${Date.now()}`;
    }

    const { data: lesson, error } = await supabase
      .from('lessons')
      .insert([{
        title,
        slug,
        description: description || null,
        category_id: category_id || null,
        grade_level: grade_level || null,
        order_index: order_index || 0,
        is_free: is_free || false,
        content_json,
        thumbnail_url: thumbnail_url || null,
        created_by: req.user.id,
      }])
      .select('id, title, slug, description, category_id, grade_level, order_index, is_free, thumbnail_url, created_by, created_at')
      .single();

    if (error) throw error;
    return res.status(201).json(lesson);
  } catch (err) {
    console.error('Create lesson error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/lessons/:id - update lesson (teacher/admin)
router.put('/:id', requireAuth, requireTeacherOrAdmin, [
  param('id').isInt().withMessage('Invalid lesson ID'),
  body('title').optional().isString().isLength({ min: 1, max: 255 }),
  body('content_json').optional().isObject(),
  body('category_id').optional({ nullable: true }).isInt(),
  body('grade_level').optional().isString().isLength({ max: 50 }),
  body('order_index').optional().isInt({ min: 0 }),
  body('is_free').optional().isBoolean(),
  body('description').optional().isString().isLength({ max: 1000 }),
  body('thumbnail_url').optional().isString().isLength({ max: 500 }),
], async (req, res) => {
  try {
    if (!handleValidation(req, res)) return;

    const { id } = req.params;
    const updates = {};
    const allowed = ['title', 'content_json', 'category_id', 'grade_level', 'order_index', 'is_free', 'description', 'thumbnail_url'];

    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    if (updates.title) {
      updates.slug = slugify(updates.title);
    }

    updates.updated_at = new Date().toISOString();

    const { data: lesson, error } = await supabase
      .from('lessons')
      .update(updates)
      .eq('id', parseInt(id))
      .select('id, title, slug, description, category_id, grade_level, order_index, is_free, thumbnail_url, created_by, created_at, updated_at')
      .single();

    if (error) throw error;
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

    return res.status(200).json(lesson);
  } catch (err) {
    console.error('Update lesson error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/lessons/:id - delete lesson (admin only)
router.delete('/:id', requireAuth, requireTeacherOrAdmin, [
  param('id').isInt().withMessage('Invalid lesson ID'),
], async (req, res) => {
  try {
    if (!handleValidation(req, res)) return;

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (profile?.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can delete lessons' });
    }

    const { error } = await supabase
      .from('lessons')
      .delete()
      .eq('id', parseInt(req.params.id));

    if (error) throw error;
    return res.status(200).json({ message: 'Lesson deleted' });
  } catch (err) {
    console.error('Delete lesson error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/lessons/:id/progress - save progress
router.post('/:id/progress', requireAuth, [
  param('id').isInt().withMessage('Invalid lesson ID'),
  body('completed_blocks').isArray().withMessage('completed_blocks must be array'),
], async (req, res) => {
  try {
    if (!handleValidation(req, res)) return;

    const lessonId = parseInt(req.params.id);
    const { completed_blocks } = req.body;

    const totalBlocks = (await supabase.from('lessons').select('content_json').eq('id', lessonId).single())?.data?.content_json?.sections?.length || 0;
    const isComplete = totalBlocks > 0 && completed_blocks.length >= totalBlocks;

    const { data, error } = await supabase
      .from('lesson_progress')
      .upsert([{
        user_id: req.user.id,
        lesson_id: lessonId,
        completed_blocks,
        completed_at: isComplete ? new Date().toISOString() : null,
      }], { onConflict: 'user_id,lesson_id' })
      .select('lesson_id, completed_blocks, completed_at')
      .single();

    if (error) throw error;
    return res.status(200).json(data);
  } catch (err) {
    console.error('Save progress error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/lessons/:id/complete - mark lesson as completed
router.post('/:id/complete', requireAuth, [
  param('id').isInt().withMessage('Invalid lesson ID'),
], async (req, res) => {
  try {
    if (!handleValidation(req, res)) return;

    const lessonId = parseInt(req.params.id);

    const { data: lesson } = await supabase
      .from('lessons')
      .select('content_json')
      .eq('id', lessonId)
      .single();

    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

    const totalBlocks = lesson.content_json?.sections?.length || 0;
    const allBlocks = Array.from({ length: totalBlocks }, (_, i) => i);

    const { data, error } = await supabase
      .from('lesson_progress')
      .upsert([{
        user_id: req.user.id,
        lesson_id: lessonId,
        completed_blocks: allBlocks,
        completed_at: new Date().toISOString(),
      }], { onConflict: 'user_id,lesson_id' })
      .select('lesson_id, completed_blocks, completed_at')
      .single();

    if (error) throw error;
    return res.status(200).json(data);
  } catch (err) {
    console.error('Complete lesson error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
