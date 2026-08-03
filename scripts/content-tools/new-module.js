#!/usr/bin/env node
/**
 * new-module.js — scaffold a new module/level for the content kit.
 *
 * Creates:
 *   /home/o/websites/E-learning/<module>/<level>/   (README.md, PROGRESS.md, general/)
 *   lms-backend/scripts/content-tools/config/<module>-<level>.json  (unit-config template)
 *
 * Usage:
 *   node scripts/content-tools/new-module.js \
 *     --module math --level 2eme --label "سنة ثانية ثانوي" \
 *     --grade grade_2 --category-name الرياضيات --category-slug math --category-id 3 \
 *     --description "دروس الرياضيات"
 */
const fs = require('fs');
const path = require('path');

const ROOT = '/home/o/websites/E-learning';
const CONFIG_DIR = path.join(ROOT, 'lms-backend', 'scripts', 'content-tools', 'config');

function arg(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function main() {
  const args = process.argv.slice(2);
  const module = arg(args, '--module');
  const level = arg(args, '--level');
  const label = arg(args, '--label') || { '1ere': 'سنة أولى ثانوي', '2eme': 'سنة ثانية ثانوي', '3eme': 'سنة ثالثة ثانوي' }[level] || 'سنة ثالثة ثانوي';
  const grade = arg(args, '--grade') || { '1ere': 'grade_1', '2eme': 'grade_2', '3eme': 'grade_3' }[level] || 'grade_3';
  const catName = arg(args, '--category-name') || (module === 'math' ? 'الرياضيات' : module);
  const catSlug = arg(args, '--category-slug') || module;
  const catId = arg(args, '--category-id');
  const desc = arg(args, '--description') || `دروس ${catName}`;

  if (!module || !level) {
    console.error('Usage: node new-module.js --module <physics|math|...> --level <1ere|2eme|3eme> [--label ...] [--grade ...]');
    process.exit(1);
  }

  const levelCode = { '1ere': '1AS', '2eme': '2AS', '3eme': '3AS' }[level] || level.toUpperCase();
  const dir = path.join(ROOT, module, level);
  fs.mkdirSync(path.join(dir, 'general'), { recursive: true });

  fs.writeFileSync(path.join(dir, 'README.md'),
    `# ${module}/${level} — ${label}\n\nDrop source PDFs here. Follow \`../../PDF-SOURCE-GUIDE.md\`:\n- course PDFs: \`${levelCode}-0N-M - <عنوان>.pdf\`\n- exercise PDFs: \`Exercice N[-R].pdf\` / \`N - تمرين <عنوان>.pdf\` / \`تمارين متنوعة…\`\n- one folder per unit: \`unit N <العنوان العربي>\`\n- general revision: \`general/\`\n\n\`grade_level\` = \`${grade}\`, \`category_id\` = \`${catId || '?'}\` (${catName}). Copy this folder's \`PROGRESS.md\` when starting.\n`,
    'utf-8');

  const progress = fs.readFileSync(path.join(ROOT, 'PROGRESS.template.md'), 'utf-8')
    .replace(/\{MODULE\}/g, module).replace(/\{LEVEL\}/g, level).replace(/\{LEVEL_LABEL\}/g, label);
  fs.writeFileSync(path.join(dir, 'PROGRESS.md'), progress, 'utf-8');

  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const cfgPath = path.join(CONFIG_DIR, `${module}-${level}.json`);
  if (!fs.existsSync(cfgPath)) {
    const cfg = {
      module, level, level_label: label, grade_level: grade,
      category: { name: catName, slug: catSlug, description: desc },
      units: [{ title: `الوحدة 1 <العنوان>`, order_index: 1, description: '' }],
    };
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
  }

  console.log(`Created ${dir}`);
  console.log(`Created config template ${cfgPath}`);
  console.log(`\nNext: drop PDFs, fill the units array, then:\n  node scripts/content-tools/seed-units.js config/${module}-${level}.json`);
}

main();
