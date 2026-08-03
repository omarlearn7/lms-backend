/**
 * insert-exercises-from-manifest.js — exercise + unit-quiz sync from a manifest.
 *
 * The manifest lists authored files; each becomes an exercise row (upsert by title).
 * Quiz files get order_index 10 and source "PREFIX U0N - Quiz" (the quizzes live in
 * the exercises table — the `quizzes` table is unused).
 *
 * Manifest format (see templates/exercise-manifest.json):
 * {
 *   "prefix": "3AS-M",
 *   "unit": "U09",
 *   "items": [
 *     { "file": "exercises/U09/001-exercice.json", "kind": "exercise" },
 *     { "file": "quizzes/U09/quiz.json",           "kind": "quiz" }
 *   ]
 * }
 *
 * Usage:
 *   node scripts/content-tools/insert-exercises-from-manifest.js config/math-3eme-U09.json
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

async function main() {
  if (!process.argv[2]) {
    console.error('Usage: node insert-exercises-from-manifest.js <manifest.json>');
    process.exit(1);
  }
  const manifestPath = path.resolve(process.argv[2]);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const prefix = manifest.prefix || '3AS';
  const unitLabel = manifest.unit || 'U00';
  const unitNum = unitLabel.replace(/\D/g, '');
  const items = manifest.items || [];

  console.log(`Manifest: ${manifest.unit} (${items.length} item(s))`);

  for (const it of items) {
    const abs = path.join(BACKEND, it.file);
    if (!fs.existsSync(abs)) {
      console.error(`!! file not found: ${it.file}`);
      continue;
    }
    const data = JSON.parse(fs.readFileSync(abs, 'utf-8'));
    const kind = it.kind || (it.file.includes('quiz') ? 'quiz' : 'exercise');
    const row = {
      unit_id: it.unit_id ?? data.unit_id,
      title: data.title,
      order_index: kind === 'quiz' ? 10 : data.order_index,
      source: kind === 'quiz'
        ? `${prefix} U${unitNum.padStart(2, '0')} - Quiz`
        : (data.source || `${prefix} U${unitNum.padStart(2, '0')} - Exercice ${data.order_index}`),
      content_json: data.content_json || data,
    };
    if (!row.title) { console.error(`!! ${it.file}: no title`); continue; }

    const { data: existing } = await supabase.from('exercises').select('id').eq('title', row.title).maybeSingle();
    if (existing) {
      const { data, error } = await supabase.from('exercises').update(row).eq('id', existing.id).select('id').single();
      if (error) { console.error(`Error updating "${row.title}": ${error.message}`); continue; }
      console.log(`Updated: "${row.title}" (id ${data.id})`);
    } else {
      const { data, error } = await supabase.from('exercises').insert(row).select('id').single();
      if (error) { console.error(`Error inserting "${row.title}": ${error.message}`); continue; }
      console.log(`Inserted: "${row.title}" (id ${data.id})`);
    }
  }
  console.log('\nDone.');
}

main().catch((e) => { console.error(e); process.exit(1); });
