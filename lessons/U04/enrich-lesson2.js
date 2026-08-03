const fs = require('fs');
const path = require('path');

const lessonPath = path.join(__dirname, '02-hamid-asse.json');
const simPath = path.join(__dirname, 'simulations', 'predominant-indicator.html');

const lesson = JSON.parse(fs.readFileSync(lessonPath, 'utf-8'));
const simHtml = fs.readFileSync(simPath, 'utf-8');

const sections = lesson.sections;

// ====== 1. Add predominant species + indicators + sim after Ka section ======
// Current: ...Ka section ends at divider idx 26 → section IV starts at 27
// Insert after idx 26 (the divider after Ka table)

const newContent = [
  {
    type: 'divider'
  },
  {
    type: 'heading',
    text: 'III-bis - مجالات الصفة الغالبة',
    level: 2
  },
  {
    type: 'text',
    content: '<p>بالنسبة لثنائي $HA/A^-$، يمكن تحديد <strong>الصفة الغالبة</strong> (espèce prédominante) في المحلول بمقارنة $pH$ مع $pK_a$:</p>'
  },
  {
    type: 'table',
    headers: ['الشرط', 'الصفة الغالبة'],
    rows: [
      ['$pH < pK_a$', 'الحمض $HA$ هو الصفة الغالبة (HA% > A⁻%)'],
      ['$pH = pK_a$', '$[HA] = [A^-]$ (لا توجد صفة غالبة)'],
      ['$pH > pK_a$', 'الأساس $A^-$ هو الصفة الغالبة (A⁻% > HA%)']
    ],
    caption: 'تحديد الصفة الغالبة بدلالة pH و pKa'
  },
  {
    type: 'formula',
    latex: '\\frac{[A^-]}{[HA]} = 10^{pH - pK_a} \\quad \\text{و} \\quad \\%HA = \\frac{100}{1 + 10^{pH - pK_a}}'
  },
  {
    type: 'note',
    variant: 'tip',
    text: 'مثال: لثنائي $CH_3COOH/CH_3COO^-$ حيث $pK_a = 4.76$، عند $pH = 3$ نجد $[A^-]/[HA] = 10^{-1.76} \\approx 0.017$ أي أن $HA$ هي الصفة الغالبة بنسبة 98%.'
  },
  {
    type: 'heading',
    text: 'III-ter - الكواشف الملونة (Indicateurs colorés)',
    level: 2
  },
  {
    type: 'text',
    content: '<p><strong>الكاشف الملون</strong> هو حمض ضعيف $HIn$ له لون مختلف عن لون أساسه المترافق $In^-$:</p>$$HIn_{(aq)} + H_2O \\rightleftharpoons In^-_{(aq)} + H_3O^+$$<p>ثابت تأينه $K_i$ يعطى بالعلاقة $K_i = \\frac{[In^-][H_3O^+]}{[HIn]}$ و $pK_i = -\\log K_i$.</p><p>يتغير لون الكاشف في مجال $pH = pK_i \\pm 1$. عند $pH < pK_i - 1$ نرى لون الحمض $HIn$، وعند $pH > pK_i + 1$ نرى لون الأساس $In^-$.</p>'
  },
  {
    type: 'table',
    headers: ['الكاشف الملون', '$pK_i$', 'مجال التغير', 'لون حمضي', 'لون قاعدي'],
    rows: [
      ['أحمر الميثيل (Méthylorange)', '3.7', '3.1 – 4.4', 'أحمر', 'أصفر'],
      ['أزرق البروموتيمول (BBT)', '6.8', '6.0 – 7.6', 'أصفر', 'أزرق'],
      ['الفينولفتالين (Phénolphtaléine)', '9.1', '8.2 – 10.0', 'عديم اللون', 'وردي']
    ],
    caption: 'أهم الكواشف الملونة ومجالات تغير لونها'
  },
  {
    type: 'text',
    content: '<p><strong>اختيار الكاشف المناسب:</strong> يجب أن يكون مجال تغير لون الكاشف داخل <strong>قفزة pH</strong> عند نقطة التكافؤ. مثلاً، لمعايرة حمض قوي بأساس قوي (قفزة pH من 4 إلى 10)، يمكن استخدام أزرق البروموتيمول أو الفينولفتالين.</p>'
  },
  {
    type: 'note',
    variant: 'tip',
    text: 'تفاعل مع المحاكاة: حرك مؤشر pH ولاحظ تغير الصفة الغالبة ولون الكاشف الملون في الوقت الفعلي.'
  },
  {
    type: 'simulation',
    kind: 'custom',
    config: {
      title: 'محاكاة تفاعلية: الصفة الغالبة والكاشف الملون',
      width: 700,
      height: 540
    },
    html: simHtml,
    css: '',
    js: ''
  }
];

// Insert after idx 26 (the divider after Ka table)
sections.splice(27, 0, ...newContent);

// ====== Update indices after insertion above ======
// The titration section (now shifted) starts at 27 + newContent.length sections later
// Let me find the current positions

// Find the titration section heading
let titrateIdx = sections.findIndex(s => s.type === 'heading' && s.text.includes('IV - المعايرة'));
let methodsEndIdx = sections.findIndex((s, i) => i > titrateIdx && s.type === 'divider');

// Insert half-equivalence and derivative methods before the divider at the end of section IV
const titrationAdditions = [
  {
    type: 'heading',
    text: 'نقطة نصف التكافؤ (Demi-équivalence)',
    level: 3
  },
  {
    type: 'text',
    content: '<p><strong>نقطة نصف التكافؤ:</strong> عندما نضيف نصف حجم الأساس اللازم للوصول إلى التكافؤ ($V_b = V_{eq}/2$). عند هذه النقطة:</p><ul><li>نصف كمية الحمض $HA$ قد تفاعلت لتتحول إلى $A^-$</li><li>إذن $[HA] = [A^-]$</li><li>وبالتالي $pH = pK_a$</li></ul><p><strong>تطبيق:</strong> يمكن تحديد $pK_a$ لحمض ضعيف بيانياً من منحنى المعايرة $pH = f(V_b)$ بإيجاد $pH$ عند $V_b = V_{eq}/2$.</p>'
  },
  {
    type: 'heading',
    text: 'طرق تحديد نقطة التكافؤ',
    level: 3
  },
  {
    type: 'text',
    content: '<p><strong>1. طريقة المماسين (Méthode des tangentes):</strong> نرسم مماسين للمنحنى $pH = f(V_b)$ قبل وبعد نقطة التكافؤ، ثم نرسم خطاً موازياً لهما في منتصف المسافة. يقطع هذا الخط المنحنى في نقطة التكافؤ.</p><p><strong>2. طريقة الاشتقاق (Dérivée):</strong> نرسم المنحنى $dpH/dV_b = f(V_b)$. يمثل رأس هذا المنحنى نقطة التكافؤ (أعلى قيمة للاشتقاق).</p><p><strong>3. المعايرة الملونة:</strong> بإضافة كاشف ملون مناسب يتغير لونه عند نقطة التكافؤ.</p>'
  },
  {
    type: 'note',
    variant: 'info',
    text: 'ملاحظة: قيمة $pK_a$ للثنائي المدروس تساوي $pH$ عند نقطة نصف التكافؤ. هذه الطريقة تسمح بتحديد $pK_a$ للحمض الضعيف تجريبياً.'
  }
];

sections.splice(methodsEndIdx, 0, ...titrationAdditions);

// ====== 3. Update existing titration methods text to be more specific ======
// Find and update the text about titration methods
const methodsTextIdx = sections.findIndex(s =>
  s.type === 'text' && s.content && s.content.includes('المعايرة الملونة')
);
if (methodsTextIdx !== -1) {
  sections[methodsTextIdx].content = '<ul><li><strong>المعايرة الملونة:</strong> باستخدام كاشف ملون مناسب (الفينولفتالين لقاعدة قوية، أحمر الميثيل لحمض قوي).</li><li><strong>المعايرة pH-مترية:</strong> باستخدام pH-متر ورسم المنحنى $pH = f(V)$ ثم تحديد نقطة التكافؤ بطريقة المماسين أو الاشتقاق.</li></ul>';
}

// ====== 4. Add note about pH meter protocol ======
// Add it right after the titration intro text
const titrateDescIdx = sections.findIndex(s =>
  s.type === 'text' && s.content && s.content.includes('تقنية تجريبية')
);
if (titrateDescIdx !== -1) {
  sections.splice(titrateDescIdx + 1, 0, {
    type: 'note',
    variant: 'info',
    text: 'البروتوكول التجريبي للمعايرة pH-مترية: 1. نملأ السحاحة بالمحلول المعاير ونضبط المستوى عند الصفر. 2. نسحب بواسطة ماصة عيارية حجماً معروفاً من المحلول المعاير ونضعه في البيشر. 3. نعاير pH-متر بمحلولين وسيطين مختلفين. 4. نغسل مسبر pH-متر جيداً بالماء المقطر ونجففه، ثم نغمره بحذر في البيشر. 5. نشغل المخلاة المغناطيسية ونبدأ في إضافة أحجام مختلفة من المحلول المعاير، ونسجل pH في كل إضافة.'
  });
}

lesson.sections = sections;
fs.writeFileSync(lessonPath, JSON.stringify(lesson, null, 2), 'utf-8');
console.log('✅  Lesson 2 enriched: predominant species, indicators, half-equivalence, titration methods');
