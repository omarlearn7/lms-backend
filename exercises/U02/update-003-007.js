require('dotenv').config({ path: '/home/o/websites/E-learning/lms-backend/.env' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const exercises = [
  { file: '003-exercice.json', title: 'تمرين 003 - حركة الأقمار الاصطناعية' },
  { file: '007-exercice.json', title: 'تمرين 007 - قوانين كبلر، سرعة الإفلات، والتحقق من قانون كبلر الثالث' },
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
      console.log(`❌ NOT FOUND: ${ex.title}`);
    }
  }
  console.log('\nDone.');
})();
