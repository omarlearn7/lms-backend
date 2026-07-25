require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// R2 Client
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

// POST /api/r2/presigned-upload
// Generate presigned URL for direct browser-to-R2 upload
router.post('/presigned-upload', async (req, res) => {
  try {
    const { fileName, contentType, courseId, title } = req.body;

    if (!fileName || !contentType) {
      return res.status(400).json({ error: 'fileName and contentType are required' });
    }

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
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/r2/confirm-upload
// After browser uploads to R2, confirm and save metadata to DB
router.post('/confirm-upload', async (req, res) => {
  try {
    const { r2Key, courseId, title, description, gradeLevel, durationSeconds, fileSizeBytes, isFree, uploadedBy } = req.body;

    if (!r2Key) {
      return res.status(400).json({ error: 'r2Key is required' });
    }

    const { data: session, error } = await supabase
      .from('recorded_sessions')
      .insert([{
        title: title || 'جلسة مسجلة',
        description: description || null,
        course_id: courseId || null,
        uploaded_by: uploadedBy || null,
        grade_level: gradeLevel || null,
        r2_key: r2Key,
        r2_bucket: R2_BUCKET,
        hls_manifest_key: null,
        duration_seconds: durationSeconds || 0,
        file_size_bytes: fileSizeBytes || 0,
        is_free: isFree || false,
      }])
      .select()
      .single();

    if (error) throw error;

    // FIFO: Enforce max 10 recordings per course
    if (courseId) {
      await enforceFIFO(courseId);
    }

    return res.status(201).json(session);
  } catch (err) {
    console.error('Confirm upload error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/r2/presigned-stream
// Generate presigned GET URL for secure video streaming
router.post('/presigned-stream', async (req, res) => {
  try {
    const { r2Key, userId } = req.body;

    if (!r2Key) {
      return res.status(400).json({ error: 'r2Key is required' });
    }

    // Check access: find the recorded session and verify user has access
    const { data: session, error: sError } = await supabase
      .from('recorded_sessions')
      .select('*')
      .eq('r2_key', r2Key)
      .single();

    if (sError || !session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Free sessions are accessible to all
    if (!session.is_free && userId) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('subscription_active, role')
        .eq('id', userId)
        .single();

      if (profile && !profile.subscription_active && !['admin', 'teacher'].includes(profile.role)) {
        return res.status(403).json({ error: 'Subscription required' });
      }
    }

    // Increment view count
    await supabase
      .from('recorded_sessions')
      .update({ view_count: (session.view_count || 0) + 1 })
      .eq('id', session.id);

    // Generate presigned URL (valid for 4 hours)
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
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/r2/recordings
// List recorded sessions with optional filters
router.get('/recordings', async (req, res) => {
  try {
    const { courseId, gradeLevel, limit = 50, offset = 0 } = req.query;

    let query = supabase
      .from('recorded_sessions')
      .select('*')
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (courseId) {
      query = query.eq('course_id', courseId);
    }
    if (gradeLevel) {
      query = query.eq('grade_level', gradeLevel);
    }

    const { data, error } = await query;
    if (error) throw error;

    return res.status(200).json(data || []);
  } catch (err) {
    console.error('List recordings error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/r2/recordings/:id
// Delete a recorded session
router.delete('/recordings/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: session, error: fError } = await supabase
      .from('recorded_sessions')
      .select('r2_key')
      .eq('id', id)
      .single();

    if (fError || !session) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    // Delete from R2
    try {
      await r2.send(new DeleteObjectCommand({
        Bucket: R2_BUCKET,
        Key: session.r2_key,
      }));
    } catch (r2Err) {
      console.error('R2 delete warning:', r2Err.message);
    }

    // Delete from DB
    const { error } = await supabase
      .from('recorded_sessions')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return res.status(200).json({ message: 'Recording deleted' });
  } catch (err) {
    console.error('Delete recording error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/r2/transcode
// Transcode uploaded MP4 to HLS (.m3u8 + .ts segments) using FFmpeg
router.post('/transcode', async (req, res) => {
  try {
    const { r2Key, recordingId } = req.body;

    if (!r2Key) {
      return res.status(400).json({ error: 'r2Key is required' });
    }

    // Check if FFmpeg is available
    const ffmpegPath = await findFFmpeg();
    if (!ffmpegPath) {
      return res.status(500).json({ error: 'FFmpeg not available on this server' });
    }

    // Download the video from R2 first
    const sourceUrl = await getSignedUrl(r2, new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
    }), { expiresIn: 7200 });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hls-'));
    const outputDir = path.join(tmpDir, 'hls');
    fs.mkdirSync(outputDir, { recursive: true });

    const manifestKey = r2Key.replace(/\.[^.]+$/, '') + '/playlist.m3u8';

    // Run FFmpeg to transcode to HLS
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
        else reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
      });
      ffmpeg.on('error', reject);
    });

    // Upload HLS segments to R2
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

    // Update DB with HLS manifest key
    if (recordingId) {
      await supabase
        .from('recorded_sessions')
        .update({ hls_manifest_key: manifestKey })
        .eq('id', recordingId);
    }

    // Cleanup temp files
    fs.rmSync(tmpDir, { recursive: true, force: true });

    return res.status(200).json({
      success: true,
      hls_manifest_key: manifestKey,
      hls_url: `${R2_PUBLIC_URL}/${manifestKey}`,
    });
  } catch (err) {
    console.error('Transcode error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Helper: Enforce FIFO (max 10 recordings per course, delete oldest)
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

// Helper: Find FFmpeg binary
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
