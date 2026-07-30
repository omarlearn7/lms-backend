require('dotenv').config({ path: '/home/o/websites/E-learning/lms-backend/.env' });
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const lessons = [
  { file: '01-RC.json', slug: 'ثنائي-القطب-RC' },
  { file: '02-RL.json', slug: 'ثنائي-القطب-RL' }
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
      const { error: insertErr } = await supabase
        .from('lessons')
        .insert([{
          title: data.title,
          slug: slug,
          description: data.description,
          category_id: data.category_id,
          unit_id: data.unit_id,
          grade_level: data.grade_level,
          order_index: data.order_index,
          is_free: data.is_free,
          content_json: { sections: data.sections },
        }]);
      if (insertErr) {
        console.error(`❌  INSERT ${file}: ${insertErr.message}`);
      } else {
        console.log(`✅  INSERTED: "${data.title}" (slug: ${slug}) — ${data.sections.length} sections`);
      }
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
