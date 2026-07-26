#!/usr/bin/env node

/**
 * Insert Lesson Script
 * 
 * Usage: node scripts/insert-lesson.js <lesson-folder-path>
 * Example: node scripts/insert-lesson.js ../lessons/chemical-transformations/
 * 
 * Reads lesson.json from the folder, uploads assets to R2, and inserts into Supabase.
 * 
 * Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const folderPath = process.argv[2];
if (!folderPath) {
  console.error('Usage: node scripts/insert-lesson.js <lesson-folder-path>');
  process.exit(1);
}

const absPath = path.resolve(folderPath);
if (!fs.existsSync(absPath)) {
  console.error(`Folder not found: ${absPath}`);
  process.exit(1);
}

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
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || `https://${R2_BUCKET}.${process.env.R2_ACCOUNT_ID}.r2.dev`;

function slugify(text) {
  return text
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

async function uploadToR2(filePath, r2Key) {
  const content = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentTypes = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
  };

  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: r2Key,
    Body: content,
    ContentType: contentTypes[ext] || 'application/octet-stream',
  }));

  return `${R2_PUBLIC_URL}/${r2Key}`;
}

async function processContent(contentJson, lessonSlug) {
  const updated = { ...contentJson };
  if (!updated.sections || !Array.isArray(updated.sections)) {
    throw new Error('content_json must have a sections array');
  }

  for (let i = 0; i < updated.sections.length; i++) {
    const block = updated.sections[i];

    // Process image blocks
    if (block.type === 'image' && block.src && block.src.startsWith('assets/')) {
      const localPath = path.join(absPath, block.src);
      if (fs.existsSync(localPath)) {
        const r2Key = `lessons/${lessonSlug}/${path.basename(block.src)}`;
        const publicUrl = await uploadToR2(localPath, r2Key);
        updated.sections[i] = { ...block, src: publicUrl };
        console.log(`  Uploaded: ${block.src} -> ${publicUrl}`);
      } else {
        console.warn(`  Warning: Image not found: ${localPath}`);
      }
    }

    // Process diagram blocks with src
    if (block.type === 'diagram' && block.src && block.src.startsWith('assets/')) {
      const localPath = path.join(absPath, block.src);
      if (fs.existsSync(localPath)) {
        const r2Key = `lessons/${lessonSlug}/${path.basename(block.src)}`;
        const publicUrl = await uploadToR2(localPath, r2Key);
        updated.sections[i] = { ...block, src: publicUrl };
        console.log(`  Uploaded diagram: ${block.src} -> ${publicUrl}`);
      }
    }
  }

  return updated;
}

async function main() {
  console.log(`\n📚 Inserting lesson from: ${absPath}\n`);

  // Read lesson.json
  const jsonPath = path.join(absPath, 'lesson.json');
  if (!fs.existsSync(jsonPath)) {
    console.error('Error: lesson.json not found in folder');
    process.exit(1);
  }

  let lessonData;
  try {
    lessonData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    console.error('Error: Invalid JSON in lesson.json:', e.message);
    process.exit(1);
  }

  // Validate required fields
  if (!lessonData.title) {
    console.error('Error: "title" is required in lesson.json');
    process.exit(1);
  }
  if (!lessonData.sections || !Array.isArray(lessonData.sections)) {
    console.error('Error: "sections" array is required in lesson.json');
    process.exit(1);
  }

  console.log(`Title: ${lessonData.title}`);
  console.log(`Sections: ${lessonData.sections.length}`);

  const slug = slugify(lessonData.title);
  console.log(`Slug: ${slug}\n`);

  // Process content (upload assets)
  console.log('📤 Processing assets...');
  const contentJson = await processContent(lessonData, slug);

  // Upload thumbnail
  let thumbnailUrl = null;
  const thumbPath = path.join(absPath, lessonData.thumbnail || 'thumbnail.png');
  if (fs.existsSync(thumbPath)) {
    console.log('📤 Uploading thumbnail...');
    thumbnailUrl = await uploadToR2(thumbPath, `lessons/${slug}/thumbnail${path.extname(thumbPath)}`);
    console.log(`  Thumbnail: ${thumbnailUrl}`);
  }

  // Look up category
  let categoryId = null;
  if (lessonData.category) {
    const { data: cat } = await supabase
      .from('categories')
      .select('id')
      .ilike('name', lessonData.category)
      .single();
    if (cat) {
      categoryId = cat.id;
      console.log(`Category: ${lessonData.category} (id: ${categoryId})`);
    } else {
      console.warn(`Warning: Category "${lessonData.category}" not found. Lesson will be uncategorized.`);
    }
  }

  // Insert into Supabase
  console.log('\n💾 Inserting into database...');
  const { data: existing } = await supabase.from('lessons').select('id').eq('slug', slug).single();
  if (existing) {
    console.log(`  Lesson with slug "${slug}" already exists (id: ${existing.id}). Updating...`);
    const { data: lesson, error } = await supabase
      .from('lessons')
      .update({
        title: lessonData.title,
        description: lessonData.description || null,
        category_id: categoryId,
        grade_level: lessonData.grade_level || null,
        order_index: lessonData.order_index || 0,
        is_free: lessonData.is_free || false,
        content_json: contentJson,
        thumbnail_url: thumbnailUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('slug', slug)
      .select('id, title, slug')
      .single();

    if (error) {
      console.error('Error updating lesson:', error.message);
      process.exit(1);
    }
    console.log(`\n✅ Lesson updated successfully!`);
    console.log(`   ID: ${lesson.id}`);
    console.log(`   Title: ${lesson.title}`);
    console.log(`   Slug: ${lesson.slug}`);
    console.log(`   URL: /lessons/${lesson.slug}`);
  } else {
    const { data: lesson, error } = await supabase
      .from('lessons')
      .insert([{
        title: lessonData.title,
        slug,
        description: lessonData.description || null,
        category_id: categoryId,
        grade_level: lessonData.grade_level || null,
        order_index: lessonData.order_index || 0,
        is_free: lessonData.is_free || false,
        content_json: contentJson,
        thumbnail_url: thumbnailUrl,
      }])
      .select('id, title, slug')
      .single();

    if (error) {
      console.error('Error inserting lesson:', error.message);
      process.exit(1);
    }
    console.log(`\n✅ Lesson created successfully!`);
    console.log(`   ID: ${lesson.id}`);
    console.log(`   Title: ${lesson.title}`);
    console.log(`   Slug: ${lesson.slug}`);
    console.log(`   URL: /lessons/${lesson.slug}`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
