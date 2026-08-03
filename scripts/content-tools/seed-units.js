/**
 * seed-units.js — create category (if new) + unit rows for a module/level.
 *
 * Reads a config file (see templates/unit-config.json), upserts categories by slug
 * and units by title, then writes a resolved config with real ids:
 *   config/<module>-<level>-resolved.json
 *
 * Usage:
 *   node scripts/content-tools/seed-units.js config/math-3eme.json
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

async function main() {
  if (!process.argv[2]) {
    console.error('Usage: node seed-units.js <config.json>');
    process.exit(1);
  }
  const cfgPath = path.resolve(process.argv[2]);
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  const { module, level, level_label, grade_level, category, units } = cfg;

  let categoryId = null;
  const { data: catRows, error: catErr } = await supabase
    .from('categories')
    .select('id')
    .eq('slug', category.slug)
    .maybeSingle();
  if (catErr) { console.error('cat lookup:', catErr.message); process.exit(1); }
  if (catRows) {
    categoryId = catRows.id;
    console.log(`Category exists: ${category.name} (id ${categoryId})`);
  } else {
    const { data, error } = await supabase
      .from('categories')
      .insert({ name: category.name, slug: category.slug, description: category.description || '' })
      .select('id')
      .single();
    if (error) { console.error('category insert:', error.message); process.exit(1); }
    categoryId = data.id;
    console.log(`Category created: ${category.name} (id ${categoryId})`);
  }

  const resolvedUnits = [];
  const { data: maxRow } = await supabase.from('units').select('id').order('id', { ascending: false }).limit(1);
  let nextId = (maxRow && maxRow[0] && maxRow[0].id) || 0;
  for (const u of units) {
    const { data: existing } = await supabase
      .from('units')
      .select('id')
      .eq('title', u.title)
      .maybeSingle();
    const row = {
      title: u.title,
      category_id: categoryId,
      grade_level: grade_level,
      order_index: u.order_index,
      description: u.description || '',
    };
    if (existing) {
      const { data, error } = await supabase.from('units').update(row).eq('id', existing.id).select('id').single();
      if (error) { console.error(`unit update "${u.title}":`, error.message); process.exit(1); }
      resolvedUnits.push({ ...row, id: data.id });
      console.log(`Unit updated: "${u.title}" (id ${data.id})`);
    } else {
      const { data, error } = await supabase.from('units').insert({ ...row, id: ++nextId }).select('id').single();
      if (error) { console.error(`unit insert "${u.title}":`, error.message); process.exit(1); }
      resolvedUnits.push({ ...row, id: data.id });
      console.log(`Unit created: "${u.title}" (id ${data.id})`);
    }
  }

  const resolved = { module, level, level_label, grade_level, category_id: categoryId, units: resolvedUnits };
  const outFile = path.join(path.dirname(cfgPath), `${module}-${level}-resolved.json`);
  fs.writeFileSync(outFile, JSON.stringify(resolved, null, 2), 'utf-8');
  console.log(`\nResolved config written: ${outFile}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
