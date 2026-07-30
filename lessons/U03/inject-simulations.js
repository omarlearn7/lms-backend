const fs = require('fs');
const path = require('path');

const simsDir = path.join(__dirname, 'simulations');
const lessonsDir = __dirname;

const configs = [
  {
    lesson: '01-RC.json',
    sim: 'oscilloscope.html',
    title: 'محاكاة راسم الاهتزاز المهبطي: عرض منحنيات دارة RC و RL',
    height: 700,
    insertIdx: 19,
    note: 'استخدم أزرار التحكم لتبديل المصدر (RC/RL) وضبط حساسية الراسم (V/div) وسرعة الكسح (ms/div) لعرض المنحنيات.'
  },
  {
    lesson: '02-RL.json',
    sim: 'oscilloscope.html',
    title: 'محاكاة راسم الاهتزاز المهبطي: عرض منحنيات دارة RC و RL',
    height: 700,
    insertIdx: 18,
    note: 'استخدم أزرار التحكم لتبديل المصدر (RC/RL) وضبط حساسية الراسم (V/div) وسرعة الكسح (ms/div) لعرض المنحنيات.'
  }
];

for (const cfg of configs) {
  const lessonPath = path.join(lessonsDir, cfg.lesson);
  const simPath = path.join(simsDir, cfg.sim);

  const lesson = JSON.parse(fs.readFileSync(lessonPath, 'utf-8'));
  const simHtml = fs.readFileSync(simPath, 'utf-8');

  const simBlock = {
    type: 'simulation',
    kind: 'custom',
    config: {
      title: cfg.title,
      width: 700,
      height: cfg.height
    },
    html: simHtml,
    css: '',
    js: ''
  };

  const sections = lesson.sections;

  // Remove any existing sim with the same title to avoid duplicates
  let removeCount = 0;
  for (let i = sections.length - 1; i >= 0; i--) {
    const s = sections[i];
    if (s.type === 'simulation' && s.config?.title === cfg.title) {
      if (i > 0 && sections[i - 1].type === 'note' && sections[i - 1].text?.includes('محاكاة')) {
        sections.splice(i - 1, 2);
        removeCount += 2;
      } else {
        sections.splice(i, 1);
        removeCount += 1;
      }
    }
  }
  if (removeCount > 0) console.log(`  Removed ${removeCount} old block(s) for "${cfg.title}"`);

  // Ensure insertIdx is within bounds
  const idx = Math.min(cfg.insertIdx, sections.length);
  sections.splice(idx, 0, simBlock);

  // Add a note block before the simulation
  const noteBlock = {
    type: 'note',
    variant: 'tip',
    text: `تفاعل مع المحاكاة: ${cfg.note}`
  };
  sections.splice(idx, 0, noteBlock);

  lesson.sections = sections;

  fs.writeFileSync(lessonPath, JSON.stringify(lesson, null, 2), 'utf-8');
  console.log(`✅  ${cfg.lesson} ← ${cfg.sim} (inserted at idx ${cfg.insertIdx})`);
}

console.log('\nDone. All lesson JSONs updated with simulations.');
