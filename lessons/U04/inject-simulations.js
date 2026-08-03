const fs = require('fs');
const path = require('path');

const simsDir = path.join(__dirname, 'simulations');
const lessonsDir = __dirname;

const configs = [
  {
    lesson: '01-tawazon-kimyai.json',
    sim: 'equilibrium.html',
    title: 'محاكاة تفاعلية: التوازن الكيميائي',
    height: 520,
    insertIdx: 30
  },
  {
    lesson: '02-hamid-asse.json',
    sim: 'titration.html',
    title: 'محاكاة تفاعلية: المعايرة حمض-أساس',
    height: 600,
    insertIdx: 34
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

  const idx = Math.min(cfg.insertIdx, sections.length);
  sections.splice(idx, 0, simBlock);

  const noteBlock = {
    type: 'note',
    variant: 'tip',
    text: `تفاعل مع المحاكاة: غير المعايير المختلفة (التركيز) وشاهد تأثيرها على النظام في الوقت الفعلي.`
  };
  sections.splice(idx, 0, noteBlock);

  lesson.sections = sections;

  fs.writeFileSync(lessonPath, JSON.stringify(lesson, null, 2), 'utf-8');
  console.log(`✅  ${cfg.lesson} ← ${cfg.sim} (inserted at idx ${cfg.insertIdx})`);
}

console.log('\nDone. All lesson JSONs updated with simulations.');
