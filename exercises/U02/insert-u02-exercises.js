require('dotenv').config({ path: '/home/o/websites/E-learning/lms-backend/.env' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const exercises = [
  { file: '004-exercice.json', title: 'تمرين 004 - مفاهيم أساسية في الميكانيك والطاقة', order: 4 },
  { file: '005-exercice.json', title: 'تمرين 005 - السقوط الحقيقي في الهواء', order: 5 },
  { file: '006-exercice.json', title: 'تمرين 006 - القذف الأفقي والطاقة في حركة القذيفة', order: 6 },
  { file: '007-exercice.json', title: 'تمرين 007 - حركة الأقمار الاصطناعية وقوانين كبلر', order: 7 },
];

(async () => {
  for (const ex of exercises) {
    const filePath = path.join(__dirname, ex.file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    const { data: existing } = await supabase
      .from('exercises')
      .select('id')
      .eq('title', ex.title)
      .single();

    if (existing) {
      const { error } = await supabase
        .from('exercises')
        .update({ content_json: data.content_json })
        .eq('id', existing.id);
      console.log(`${error ? '❌' : '✅'} UPDATE ${ex.title} — ${error ? error.message : 'ok'}`);
    } else {
      const { error } = await supabase
        .from('exercises')
        .insert([{
          unit_id: 2,
          title: ex.title,
          order_index: ex.order,
          source: data.source || ('3AS U02 - Exercice ' + String(ex.order).padStart(3, '0')),
          content_json: data.content_json,
        }]);
      console.log(`${error ? '❌' : '✅'} INSERT ${ex.title} — ${error ? error.message : 'ok'}`);
    }
  }
  console.log('\nDone.');
})();
