/**
 * insert-lessons-from-dir.js — manifest-free lesson sync.
 *
 * Scans directories of authored lesson JSON files (top-level `sections` schema)
 * and upserts each into the DB by `title`. No giant hand-maintained array.
 *
 * Usage:
 *   node scripts/content-tools/insert-lessons-from-dir.js lessons/U09
 *   node scripts/content-tools/insert-lessons-from-dir.js lessons/U09 lessons/U10
 *
 * Each file must contain: title, slug, description, category_id, unit_id,
 * grade_level, order_index, is_free, sections.
 */
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const BACKEND = path.join(__dirname, '..', '..');

function collectFiles(dirs) {
  const files = [];
  for (const d of dirs) {
    const abs = path.resolve(d);
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      for (const f of fs.readdirSync(abs).sort()) {
        if (f.endsWith('.json')) files.push(path.join(abs, f));
      }
    } else if (abs.endsWith('.json')) {
      files.push(abs);
    }
  }
  return files;
}

async function main() {
  const dirs = process.argv.slice(2);
  if (dirs.length === 0) {
    console.error('Usage: node insert-lessons-from-dir.js <lesson.json | dir> ...');
    process.exit(1);
  }
  const files = collectFiles(dirs);
  console.log(`Found ${files.length} lesson file(s)`);

  for (const file of files) {
    const lesson = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const required = ['title', 'slug', 'description', 'category_id', 'unit_id', 'grade_level', 'order_index', 'is_free', 'sections'];
    const missing = required.filter((k) => lesson[k] === undefined);
    if (missing.length) {
      console.error(`!! ${path.basename(file)} missing: ${missing.join(', ')} — skipped`);
      continue;
    }
    if (!Array.isArray(lesson.sections) || lesson.sections.length === 0) {
      console.error(`!! ${path.basename(file)}: empty/missing sections — skipped`);
      continue;
    }
    const row = {
      title: lesson.title,
      slug: lesson.slug,
      description: lesson.description,
      category_id: lesson.category_id,
      unit_id: lesson.unit_id,
      grade_level: lesson.grade_level,
      order_index: lesson.order_index,
      is_free: lesson.is_free,
      content_json: lesson,
    };

    const { data: existing } = await supabase.from('lessons').select('id').eq('title', row.title).maybeSingle();
    if (existing) {
      const { data, error } = await supabase.from('lessons').update(row).eq('id', existing.id).select('id').single();
      if (error) { console.error(`Error updating "${row.title}": ${error.message}`); continue; }
      console.log(`Updated: "${row.title}" (id ${data.id})`);
    } else {
      const { data, error } = await supabase.from('lessons').insert(row).select('id').single();
      if (error) { console.error(`Error inserting "${row.title}": ${error.message}`); continue; }
      console.log(`Inserted: "${row.title}" (id ${data.id})`);
    }
  }
  console.log('\nDone.');
}

main().catch((e) => { console.error(e); process.exit(1); });
