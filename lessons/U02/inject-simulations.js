const fs = require('fs');
const path = require('path');

const simsDir = path.join(__dirname, 'simulations');
const lessonsDir = __dirname;

const configs = [
  {
    lesson: '01-mefahim-asasiya.json',
    sim: 'forces-energy.html',
    title: 'محاكاة تفاعلية: القوى والعمل والطاقة',
    height: 580,
    insertIdx: 46
  },
  {
    lesson: '02-sokout-chakouli.json',
    sim: 'freefall.html',
    title: 'محاكاة تفاعلية: السقوط الشاقولي',
    height: 820,
    insertIdx: 30
  },
  {
    lesson: '03-harakat-alqadifa.json',
    sim: 'projectile.html',
    title: 'محاكاة تفاعلية: حركة القذيفة',
    height: 840,
    insertIdx: 20
  },
  {
    lesson: '04-aqmar-alkawakib.json',
    sim: 'orbit.html',
    title: 'محاكاة تفاعلية: حركة الأقمار الاصطناعية',
    height: 840,
    insertIdx: 27
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

  // Ensure insertIdx is within bounds
  const idx = Math.min(cfg.insertIdx, sections.length);
  sections.splice(idx, 0, simBlock);

  // Add a note block before the simulation
  const noteBlock = {
    type: 'note',
    variant: 'tip',
    text: `<strong>تفاعل مع المحاكاة:</strong> جرب تغيير المعايير المختلفة وشاهد تأثيرها على الحركة في الوقت الفعلي. استخدم أزرار التشغيل والإيقاف للتحكم في المحاكاة.`
  };
  sections.splice(idx, 0, noteBlock);

  lesson.sections = sections;

  fs.writeFileSync(lessonPath, JSON.stringify(lesson, null, 2), 'utf-8');
  console.log(`✅  ${cfg.lesson} ← ${cfg.sim} (inserted at idx ${cfg.insertIdx})`);
}

console.log('\nDone. All lesson JSONs updated with simulations.');
