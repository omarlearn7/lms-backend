require('dotenv').config({ path: '../../.env' });
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const lessons = [
  { file: '01-mefahim-asasiya.json', slug: 'مفاهيم-أساسية-في-الميكانيك-والطاقة' },
  { file: '02-sokout-chakouli.json', slug: 'السقوط-الشاقولي' },
  { file: '03-harakat-alqadifa.json', slug: 'حركة-القذيفة' },
  { file: '04-aqmar-alkawakib.json', slug: 'حركة-الأقمار-الاصطناعية-والكواكب' }
];

(async () => {
  for (const { file, slug } of lessons) {
    const jsonPath = path.join(__dirname, file);
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

    const { data: lesson, error: findErr } = await supabase
      .from('lessons')
      .select('id, title, slug')
      .eq('slug', slug)
      .single();

    if (findErr || !lesson) {
      console.error(`❌  Not found: ${slug} — ${findErr?.message || 'no data'}`);
      continue;
    }

    const { error: updateErr } = await supabase
      .from('lessons')
      .update({
        content_json: { sections: data.sections },
        updated_at: new Date().toISOString()
      })
      .eq('id', lesson.id);

    if (updateErr) {
      console.error(`❌  ${file}: ${updateErr.message}`);
    } else {
      console.log(`✅  Updated: "${lesson.title}" (id: ${lesson.id}) — ${data.sections.length} sections`);
    }
  }
  console.log('\nDone.');
})();
