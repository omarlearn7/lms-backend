require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { body, param, query, validationResult } = require('express-validator');
const { requireAuth, requireTeacherOrAdmin } = require('../middleware/supabase');
const { getUserAccess } = require('../lib/access');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const R2_BUCKET = process.env.R2_BUCKET_NAME || 'paid-course-streams';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || `https://${process.env.R2_BUCKET_NAME}.${process.env.R2_ACCOUNT_ID}.r2.dev`;
const MAX_SESSIONS_PER_COURSE = 10;

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Invalid input', details: errors.array().map(e => e.msg) });
  }
}

// OPTIONS /api/r2/cors-check
router.options('/cors-check', (req, res) => {
  res.sendStatus(204);
});

router.get('/cors-check', requireAuth, requireTeacherOrAdmin, async (req, res) => {
  try {
    await r2.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: '__cors_check.txt',
      Body: 'ok',
      ContentType: 'text/plain',
    }));

    await r2.send(new DeleteObjectCommand({
      Bucket: R2_BUCKET,
      Key: '__cors_check.txt',
    }));

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('R2 CORS check error:', err);
    return res.status(500).json({ ok: false, error: 'R2 connectivity check failed' });
  }
});

// POST /api/r2/presigned-upload
router.post('/presigned-upload', requireAuth, requireTeacherOrAdmin, [
  body('fileName').isString().isLength({ min: 1, max: 255 }).withMessage('fileName required (max 255 chars)'),
  body('contentType').isString().isLength({ min: 1, max: 100 }).withMessage('contentType required'),
  body('courseId').optional({ nullable: true }).isUUID().withMessage('Invalid courseId'),
  body('title').optional().isString().isLength({ max: 200 }).withMessage('Title max 200 chars'),
], async (req, res) => {
  try {
    if (!handleValidation(req, res)) return;
    const { fileName, contentType, courseId, title } = req.body;

    const timestamp = Date.now();
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const r2Key = `recordings/${courseId || 'uncategorized'}/${timestamp}_${safeName}`;

    const command = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
      ContentType: contentType,
      Metadata: {
        title: title || '',
        course_id: String(courseId || ''),
      },
    });

    const presignedUrl = await getSignedUrl(r2, command, { expiresIn: 3600 });

    return res.status(200).json({
      presignedUrl,
      r2Key,
      publicUrl: `${R2_PUBLIC_URL}/${r2Key}`,
    });
  } catch (err) {
    console.error('Presigned upload error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/r2/confirm-upload
router.post('/confirm-upload', requireAuth, requireTeacherOrAdmin, [
  body('r2Key').isString().isLength({ min: 1, max: 500 }).withMessage('r2Key required'),
  body('title').optional().isString().isLength({ max: 200 }).withMessage('Title max 200 chars'),
  body('description').optional().isString().isLength({ max: 2000 }).withMessage('Description max 2000 chars'),
  body('durationSeconds').optional().isInt({ min: 0 }).withMessage('durationSeconds must be non-negative'),
  body('fileSizeBytes').optional().isInt({ min: 0 }).withMessage('fileSizeBytes must be non-negative'),
  body('isFree').optional().isBoolean().withMessage('isFree must be boolean'),
], async (req, res) => {
  try {
    if (!handleValidation(req, res)) return;
    const { r2Key, courseId, title, description, gradeLevel, durationSeconds, fileSizeBytes, isFree, uploadedBy } = req.body;

    const { data: session, error } = await supabase
      .from('recorded_sessions')
      .insert([{
        title: title || 'جلسة مسجلة',
        description: description || null,
        course_id: courseId || null,
        uploaded_by: uploadedBy || req.user.id,
        grade_level: gradeLevel || null,
        r2_key: r2Key,
        r2_bucket: R2_BUCKET,
        hls_manifest_key: null,
        duration_seconds: durationSeconds || 0,
        file_size_bytes: fileSizeBytes || 0,
        is_free: isFree || false,
      }])
      .select('id, title, description, course_id, duration_seconds, file_size_bytes, is_free, created_at')
      .single();

    if (error) throw error;

    if (courseId) {
      await enforceFIFO(courseId);
    }

    return res.status(201).json(session);
  } catch (err) {
    console.error('Confirm upload error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/r2/confirm-video-upload
router.post('/confirm-video-upload', requireAuth, requireTeacherOrAdmin, [
  body('r2Key').isString().isLength({ min: 1, max: 500 }).withMessage('r2Key required'),
  body('courseId').isUUID().withMessage('Invalid courseId'),
  body('title').optional().isString().isLength({ max: 200 }).withMessage('Title max 200 chars'),
  body('description').optional().isString().isLength({ max: 2000 }).withMessage('Description max 2000 chars'),
  body('durationMinutes').optional().isInt({ min: 1, max: 600 }).withMessage('Duration must be 1-600 minutes'),
  body('isFree').optional().isBoolean().withMessage('isFree must be boolean'),
], async (req, res) => {
  try {
    if (!handleValidation(req, res)) return;
    const { r2Key, courseId, title, description, durationMinutes, fileSizeBytes, isFree, uploadedBy } = req.body;

    const { data: video, error } = await supabase
      .from('videos')
      .insert([{
        course_id: courseId,
        title: title || 'فيديو مسجل',
        description: description || null,
        youtube_video_id: null,
        source_type: 'r2',
        r2_key: r2Key,
        r2_bucket: R2_BUCKET,
        hls_manifest_key: null,
        duration_minutes: durationMinutes || 15,
        is_free: isFree || false,
      }])
      .select('id, title, description, course_id, source_type, duration_minutes, is_free, created_at')
      .single();

    if (error) throw error;

    if (courseId) {
      await enforceVideoFIFO(courseId);
    }

    return res.status(201).json(video);
  } catch (err) {
    console.error('Confirm video upload error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/r2/presigned-stream
router.post('/presigned-stream', requireAuth, [
  body('r2Key').isString().isLength({ min: 1, max: 500 }).withMessage('r2Key required'),
], async (req, res) => {
  try {
    if (!handleValidation(req, res)) return;
    const { r2Key } = req.body;
    const userId = req.user.id;

    const { data: session, error: sError } = await supabase
      .from('recorded_sessions')
      .select('id, title, description, is_free, duration_seconds, file_size_bytes, view_count')
      .eq('r2_key', r2Key)
      .single();

    if (sError || !session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const access = await getUserAccess(userId);
    if (!access.hasAccess) {
      return res.status(403).json({ error: 'Subscription required' });
    }

    await supabase
      .from('recorded_sessions')
      .update({ view_count: (session.view_count || 0) + 1 })
      .eq('id', session.id);

    const command = new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
    });

    const presignedUrl = await getSignedUrl(r2, command, { expiresIn: 14400 });

    return res.status(200).json({
      url: presignedUrl,
      session,
    });
  } catch (err) {
    console.error('Presigned stream error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/r2/recordings (any authenticated user with active access; staff see all)
router.get('/recordings', requireAuth, [
  query('courseId').optional().isUUID().withMessage('Invalid courseId'),
  query('gradeLevel').optional().isString().isLength({ max: 50 }),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be 1-100'),
  query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be non-negative'),
], async (req, res) => {
  try {
    if (!handleValidation(req, res)) return;
    const { courseId, gradeLevel, limit = 50, offset = 0 } = req.query;

    const access = await getUserAccess(req.user.id);
    if (!access.hasAccess) {
      return res.status(403).json({ error: 'Subscription required' });
    }

    let queryBuilder = supabase
      .from('recorded_sessions')
      .select('id, title, description, course_id, grade_level, duration_seconds, file_size_bytes, is_free, view_count, created_at')
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (courseId) {
      queryBuilder = queryBuilder.eq('course_id', courseId);
    }
    if (gradeLevel) {
      queryBuilder = queryBuilder.eq('grade_level', gradeLevel);
    }

    const { data, error } = await queryBuilder;
    if (error) throw error;

    return res.status(200).json(data || []);
  } catch (err) {
    console.error('List recordings error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/r2/recordings/:id
router.delete('/recordings/:id', requireAuth, requireTeacherOrAdmin, [
  param('id').isUUID().withMessage('Invalid recording ID'),
], async (req, res) => {
  try {
    if (!handleValidation(req, res)) return;
    const { id } = req.params;

    const { data: session, error: fError } = await supabase
      .from('recorded_sessions')
      .select('r2_key')
      .eq('id', id)
      .single();

    if (fError || !session) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    try {
      await r2.send(new DeleteObjectCommand({
        Bucket: R2_BUCKET,
        Key: session.r2_key,
      }));
    } catch (r2Err) {
      console.error('R2 delete warning:', r2Err.message);
    }

    const { error } = await supabase
      .from('recorded_sessions')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return res.status(200).json({ message: 'Recording deleted' });
  } catch (err) {
    console.error('Delete recording error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/r2/transcode
router.post('/transcode', requireAuth, requireTeacherOrAdmin, [
  body('r2Key').isString().isLength({ min: 1, max: 500 }).withMessage('r2Key required'),
  body('recordingId').optional().isUUID().withMessage('Invalid recordingId'),
], async (req, res) => {
  try {
    if (!handleValidation(req, res)) return;
    const { r2Key, recordingId } = req.body;

    const ffmpegPath = await findFFmpeg();
    if (!ffmpegPath) {
      return res.status(500).json({ error: 'Transcoding not available on this server' });
    }

    const sourceUrl = await getSignedUrl(r2, new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
    }), { expiresIn: 7200 });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hls-'));
    const outputDir = path.join(tmpDir, 'hls');
    fs.mkdirSync(outputDir, { recursive: true });

    const manifestKey = r2Key.replace(/\.[^.]+$/, '') + '/playlist.m3u8';

    await new Promise((resolve, reject) => {
      const ffmpeg = spawn(ffmpegPath, [
        '-i', sourceUrl,
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-c:a', 'aac',
        '-f', 'hls',
        '-hls_time', '6',
        '-hls_list_size', '0',
        '-hls_segment_filename', path.join(outputDir, 'segment_%03d.ts'),
        path.join(outputDir, 'playlist.m3u8'),
      ]);

      let stderr = '';
      ffmpeg.stderr.on('data', (d) => { stderr += d.toString(); });
      ffmpeg.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Transcoding failed with code ${code}`));
      });
      ffmpeg.on('error', reject);
    });

    const files = fs.readdirSync(outputDir);
    for (const file of files) {
      const filePath = path.join(outputDir, file);
      const fileContent = fs.readFileSync(filePath);
      const segmentKey = `recordings/${r2Key.split('/').slice(0, -1).join('/')}/${file}`;
      const contentType = file.endsWith('.m3u8') ? 'application/x-mpegURL' : 'video/mp2t';

      await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: segmentKey,
        Body: fileContent,
        ContentType: contentType,
      }));
    }

    if (recordingId) {
      await supabase
        .from('recorded_sessions')
        .update({ hls_manifest_key: manifestKey })
        .eq('id', recordingId);
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });

    return res.status(200).json({
      success: true,
      hls_manifest_key: manifestKey,
      hls_url: `${R2_PUBLIC_URL}/${manifestKey}`,
    });
  } catch (err) {
    console.error('Transcode error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

async function enforceFIFO(courseId) {
  try {
    const { data: sessions } = await supabase
      .from('recorded_sessions')
      .select('id, r2_key')
      .eq('course_id', courseId)
      .order('created_at', { ascending: false });

    if (sessions && sessions.length > MAX_SESSIONS_PER_COURSE) {
      const toDelete = sessions.slice(MAX_SESSIONS_PER_COURSE);
      for (const s of toDelete) {
        try {
          await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: s.r2_key }));
        } catch (e) {
          console.error('FIFO R2 delete warning:', e.message);
        }
        await supabase.from('recorded_sessions').delete().eq('id', s.id);
      }
    }
  } catch (err) {
    console.error('FIFO enforcement error:', err);
  }
}

async function enforceVideoFIFO(courseId) {
  try {
    const { data: videos } = await supabase
      .from('videos')
      .select('id, r2_key, source_type')
      .eq('course_id', courseId)
      .order('created_at', { ascending: false });

    if (videos && videos.length > MAX_SESSIONS_PER_COURSE) {
      const toDelete = videos.slice(MAX_SESSIONS_PER_COURSE);
      for (const v of toDelete) {
        if (v.source_type === 'r2' && v.r2_key) {
          try {
            await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: v.r2_key }));
          } catch (e) {
            console.error('Video FIFO R2 delete warning:', e.message);
          }
        }
        await supabase.from('videos').delete().eq('id', v.id);
      }
    }
  } catch (err) {
    console.error('Video FIFO enforcement error:', err);
  }
}

async function findFFmpeg() {
  const possiblePaths = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg'];
  for (const p of possiblePaths) {
    try {
      const { execSync } = require('child_process');
      execSync(`${p} -version`, { stdio: 'ignore' });
      return p;
    } catch (e) {
      continue;
    }
  }
  return null;
}

module.exports = router;
