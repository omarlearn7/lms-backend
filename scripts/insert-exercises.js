const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../.env' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const exercises = [
  {
    unit_id: 1,
    title: 'تمرين 004 - تحضير محلول هيدروكسيد الصوديوم',
    order_index: 4,
    source: '3AS U01 - Exercice 003-R',
    content_json: require('../exercises/U01/004-exercice.json').content_json,
  },
  {
    unit_id: 1,
    title: 'تمرين 005 - الكافيين والسكروز في المشروبات الغازية',
    order_index: 5,
    source: '3AS U01 - Exercice 005',
    content_json: require('../exercises/U01/005-exercice.json').content_json,
  },
  {
    unit_id: 1,
    title: 'تمرين 006 - حمض الخل',
    order_index: 6,
    source: '3AS U01 - Exercice 001-R2',
    content_json: require('../exercises/U01/006-exercice.json').content_json,
  },
  {
    unit_id: 1,
    title: 'تمرين 007 - تفاعل الزنك مع حمض كلور الهيدروجين',
    order_index: 7,
    source: '3AS U01 - Exercice 010-R',
    content_json: require('../exercises/U01/007-exercice.json').content_json,
  },
  {
    unit_id: 1,
    title: 'تمرين 008 - معايرة غاز SO₂ في الهواء',
    order_index: 8,
    source: '3AS U01 - Exercice 016-R',
    content_json: require('../exercises/U01/008-exercice.json').content_json,
  },
  {
    unit_id: 1,
    title: 'تمرين 009 - كتابة المعادلات النصفية للأكسدة والإرجاع',
    order_index: 9,
    source: '3AS U01 - Exercice 007-R',
    content_json: require('../exercises/U01/009-exercice.json').content_json,
  },
  {
    unit_id: 1,
    title: 'تمرين 010 - متابعة تحول كيميائي بطريقة المعايرة',
    order_index: 10,
    source: '3AS U01 - Exercice 038-R',
    content_json: require('../exercises/U01/010-exercice.json').content_json,
  },
  {
    unit_id: 1,
    title: 'تمرين 011 - العوامل الحركية وتأثيرها على سرعة التفاعل',
    order_index: 11,
    source: '3AS U01',
    content_json: require('../exercises/U01/011-exercice.json').content_json,
  },
  {
    unit_id: 1,
    title: 'تمرين 002 - تحضير محلول بالتخفيف',
    order_index: 2,
    source: '3AS U01 - Exercice 002',
    content_json: require('../exercises/U01/002-exercice.json').content_json,
  },
  {
    unit_id: 1,
    title: 'تمرين 003 - المتابعة الزمنية لتحول كيميائي',
    order_index: 3,
    source: '3AS U01 - Exercice 003',
    content_json: require('../exercises/U01/003-exercice.json').content_json,
  },
  {
    unit_id: 2,
    title: 'تمرين 001 - السقوط الشاقولي لجسم صلب',
    order_index: 1,
    source: '3AS U02 - Exercice 001',
    content_json: require('../exercises/U02/001-exercice.json').content_json,
  },
  {
    unit_id: 2,
    title: 'تمرين 002 - حركة القذيفة',
    order_index: 2,
    source: '3AS U02 - Exercice 002',
    content_json: require('../exercises/U02/002-exercice.json').content_json,
  },
  {
    unit_id: 2,
    title: 'تمرين 003 - حركة الأقمار الاصطناعية',
    order_index: 3,
    source: '3AS U02 - Exercice 003',
    content_json: require('../exercises/U02/003-exercice.json').content_json,
  },
  {
    unit_id: 3,
    title: 'تمرين 001 - ثنائي القطب RC',
    order_index: 1,
    source: '3AS U03 - Exercice 001',
    content_json: require('../exercises/U03/001-exercice.json').content_json,
  },
  {
    unit_id: 3,
    title: 'تمرين 002 - ثنائي القطب RL',
    order_index: 2,
    source: '3AS U03 - Exercice 002',
    content_json: require('../exercises/U03/002-exercice.json').content_json,
  },
  {
    unit_id: 4,
    title: 'تمرين 001 - التوازن الكيميائي',
    order_index: 1,
    source: '3AS U04 - Exercice 001',
    content_json: require('../exercises/U04/001-exercice.json').content_json,
  },
  {
    unit_id: 4,
    title: 'تمرين 002 - التفاعلات المرفقة بتفاعل حمض-أساس',
    order_index: 2,
    source: '3AS U04 - Exercice 002',
    content_json: require('../exercises/U04/002-exercice.json').content_json,
  },
  {
    unit_id: 5,
    title: 'تمرين 001 - النشاط الإشعاعي',
    order_index: 1,
    source: '3AS U05 - Exercice 001',
    content_json: require('../exercises/U05/001-exercice.json').content_json,
  },
  {
    unit_id: 5,
    title: 'تمرين 002 - التحولات النووية المستحدثة',
    order_index: 2,
    source: '3AS U05 - Exercice 002',
    content_json: require('../exercises/U05/002-exercice.json').content_json,
  },
  {
    unit_id: 6,
    title: 'تمرين 001 - مراقبة تطور جملة كيميائية بمعايرة حمض-أساس',
    order_index: 1,
    source: '3AS U06 - Exercice 001',
    content_json: require('../exercises/U06/001-exercice.json').content_json,
  },
  {
    unit_id: 6,
    title: 'تمرين 002 - الأعمدة الكهربائية',
    order_index: 2,
    source: '3AS U06 - Exercice 002',
    content_json: require('../exercises/U06/002-exercice.json').content_json,
  },
  {
    unit_id: 7,
    title: 'تمرين 001 - الاهتزازات الحرة لجملة ميكانيكية',
    order_index: 1,
    source: '3AS U07 - Exercice 001',
    content_json: require('../exercises/U07/001-exercice.json').content_json,
  },
  {
    unit_id: 7,
    title: 'تمرين 002 - الاهتزازات الحرة لجملة كهربائية (LC)',
    order_index: 2,
    source: '3AS U07 - Exercice 002',
    content_json: require('../exercises/U07/002-exercice.json').content_json,
  },
  {
    unit_id: 7,
    title: 'تمرين 003 - الاهتزازات القسرية',
    order_index: 3,
    source: '3AS U07 - Exercice 003',
    content_json: require('../exercises/U07/003-exercice.json').content_json,
  },
  {
    unit_id: 8,
    title: 'تمرين 001 - ظاهرة الانتشار',
    order_index: 1,
    source: '3AS U08 - Exercice 001',
    content_json: require('../exercises/U08/001-exercice.json').content_json,
  },
];

(async () => {
  // Fetch existing titles to avoid duplicates
  const { data: existing } = await supabase.from('exercises').select('title');
  const existingTitles = new Set(existing.map(e => e.title));

  for (const ex of exercises) {
    if (existingTitles.has(ex.title)) {
      console.log(`Skipped (already exists): "${ex.title}"`);
      continue;
    }
    const { data, error } = await supabase.from('exercises').insert(ex).select('id');
    if (error) {
      console.error(`Error inserting "${ex.title}": ${error.message}`);
    } else {
      console.log(`Inserted: "${ex.title}" (id: ${data[0].id})`);
    }
  }
})();
