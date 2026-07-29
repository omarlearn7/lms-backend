const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../.env' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const lessons = [
  {
    title: 'مفاهيم أساسية في الميكانيك والطاقة',
    slug: 'مفاهيم-أساسية-في-الميكانيك-والطاقة',
    description: 'دراسة المرجع والمعلم، شعاع السرعة والتسارع، العمل والطاقة',
    category_id: 2,
    unit_id: 2,
    grade_level: 'سنة ثالثة ثانوي',
    order_index: 1,
    is_free: true,
    content_json: require('../lessons/U02/01-mefahim-asasiya.json'),
  },
  {
    title: 'السقوط الشاقولي',
    slug: 'السقوط-الشاقولي',
    description: 'دراسة حركة السقوط الشاقولي في الهواء: السقوط الحر مع إهمال الاحتكاك، السقوط مع وجود الاحتكاك، القذف الشاقولي',
    category_id: 2,
    unit_id: 2,
    grade_level: 'سنة ثالثة ثانوي',
    order_index: 2,
    is_free: true,
    content_json: require('../lessons/U02/02-sokout-chakouli.json'),
  },
  {
    title: 'حركة القذيفة',
    slug: 'حركة-القذيفة',
    description: 'دراسة حركة المقذوفات: مدى القذيفة، أقصى ارتفاع، معادلة المسار، تأثير السرعة الابتدائية والزاوية',
    category_id: 2,
    unit_id: 2,
    grade_level: 'سنة ثالثة ثانوي',
    order_index: 3,
    is_free: true,
    content_json: require('../lessons/U02/03-harakat-alqadifa.json'),
  },
  {
    title: 'حركة الأقمار الاصطناعية والكواكب',
    slug: 'حركة-الأقمار-الاصطناعية-والكواكب',
    description: 'قوانين كبلر، قانون الجذب العام لنيوتن، حركة الأقمار الاصطناعية، السرعة المدارية، السرعة القصوى للإفلات',
    category_id: 2,
    unit_id: 2,
    grade_level: 'سنة ثالثة ثانوي',
    order_index: 4,
    is_free: true,
    content_json: require('../lessons/U02/04-aqmar-alkawakib.json'),
  },
  {
    title: 'ثنائي القطب RC',
    slug: 'ثنائي-القطب-RC',
    description: 'دراسة المكثفة وشحنها وتفريغها في دارة RC، ثابت الزمن، المعادلات التفاضلية، الطاقة المخزنة',
    category_id: 2,
    unit_id: 3,
    grade_level: 'سنة ثالثة ثانوي',
    order_index: 1,
    is_free: true,
    content_json: require('../lessons/U03/01-RC.json'),
  },
  {
    title: 'ثنائي القطب RL',
    slug: 'ثنائي-القطب-RL',
    description: 'دراسة الوشيعة (المحث) واستجابة دارة RL، ثابت الزمن، المعادلات التفاضلية، الطاقة المخزنة',
    category_id: 2,
    unit_id: 3,
    grade_level: 'سنة ثالثة ثانوي',
    order_index: 2,
    is_free: true,
    content_json: require('../lessons/U03/02-RL.json'),
  },
  {
    title: 'التوازن الكيميائي',
    slug: 'التوازن-الكيميائي',
    description: 'دراسة التوازن الكيميائي: ثابت التوازن، قاعدة لوشاتيلييه، التفاعلات الانعكاسية وغير الانعكاسية',
    category_id: 1,
    unit_id: 4,
    grade_level: 'سنة ثالثة ثانوي',
    order_index: 1,
    is_free: true,
    content_json: require('../lessons/U04/01-tawazon-kimyai.json'),
  },
  {
    title: 'التفاعلات المرفقة بتفاعل حمض-أساس',
    slug: 'التفاعلات-المرفقة-بتفاعل-حمض-أساس',
    description: 'دراسة التفاعلات الحمضية-القاعدية، المعايرة، pH المحاليل، الثنائيات المترافقة',
    category_id: 1,
    unit_id: 4,
    grade_level: 'سنة ثالثة ثانوي',
    order_index: 2,
    is_free: true,
    content_json: require('../lessons/U04/02-hamid-asse.json'),
  },
  {
    title: 'النشاط الإشعاعي',
    slug: 'النشاط-الإشعاعي',
    description: 'دراسة الظواهر النووية: النشاط الإشعاعي، أنواع الإشعاعات، قانون التناقص الإشعاعي، عمر النصف',
    category_id: 2,
    unit_id: 5,
    grade_level: 'سنة ثالثة ثانوي',
    order_index: 1,
    is_free: true,
    content_json: require('../lessons/U05/01-nachat-ichiai.json'),
  },
  {
    title: 'التحولات النووية المستحدثة',
    slug: 'التحولات-النووية-المستحدثة',
    description: 'دراسة التفاعلات النووية المستحدثة: الانشطار النووي، الاندماج النووي، تطبيقاتها، الطاقة النووية',
    category_id: 2,
    unit_id: 5,
    grade_level: 'سنة ثالثة ثانوي',
    order_index: 2,
    is_free: true,
    content_json: require('../lessons/U05/02-tahawolat-nawawia.json'),
  },
  {
    title: 'مراقبة تطور جملة كيميائية',
    slug: 'مراقبة-تطور-جملة-كيميائية',
    description: 'طرق مراقبة تطور التفاعلات الكيميائية: المعايرة، قياس الناقلية، قياس pH، التحليل الكهربائي',
    category_id: 1,
    unit_id: 6,
    grade_level: 'سنة ثالثة ثانوي',
    order_index: 1,
    is_free: true,
    content_json: require('../lessons/U06/01-mourakaba.json'),
  },
  {
    title: 'الأعمدة الكهربائية',
    slug: 'الأعمدة-الكهربائية',
    description: 'دراسة الأعمدة الكهربائية: تفاعلات الأكسدة-الإرجاع، القوة المحركة الكهربائية، أنواع الأعمدة، تطبيقاتها',
    category_id: 1,
    unit_id: 6,
    grade_level: 'سنة ثالثة ثانوي',
    order_index: 2,
    is_free: true,
    content_json: require('../lessons/U06/02-aamoud.json'),
  },
  {
    title: 'الاهتزازات الحرة لجملة ميكانيكية',
    slug: 'الاهتزازات-الحرة-لجملة-ميكانيكية',
    description: 'دراسة الاهتزازات الحرة: النواس المرن، النواس البسيط، الطاقة في الحركة الاهتزازية، التخميد',
    category_id: 2,
    unit_id: 7,
    grade_level: 'سنة ثالثة ثانوي',
    order_index: 1,
    is_free: true,
    content_json: require('../lessons/U07/01-ihzazat-mikanikia.json'),
  },
  {
    title: 'الاهتزازات الحرة لجملة كهربائية',
    slug: 'الاهتزازات-الحرة-لجملة-كهربائية',
    description: 'دراسة دارة LC: التذبذبات الكهربائية الحرة، الطاقة في دارة LC، تخميد التذبذبات',
    category_id: 2,
    unit_id: 7,
    grade_level: 'سنة ثالثة ثانوي',
    order_index: 2,
    is_free: true,
    content_json: require('../lessons/U07/02-ihzazat-kahrabai.json'),
  },
  {
    title: 'الاهتزازات القسرية',
    slug: 'الاهتزازات-القسرية',
    description: 'دراسة الاهتزازات القسرية: الرنين في الأنظمة الميكانيكية والكهربائية، عرض الرنين، تطبيقات',
    category_id: 2,
    unit_id: 7,
    grade_level: 'سنة ثالثة ثانوي',
    order_index: 3,
    is_free: true,
    content_json: require('../lessons/U07/03-ihzazat-qasria.json'),
  },
  {
    title: 'ظواهر الانتشار',
    slug: 'ظواهر-الانتشار',
    description: 'دراسة الأمواج الميكانيكية المتوالية: الموجات الطولية والعرضية، سرعة الانتشار، ظواهر الحيود والترابط',
    category_id: 2,
    unit_id: 8,
    grade_level: 'سنة ثالثة ثانوي',
    order_index: 1,
    is_free: true,
    content_json: require('../lessons/U08/01-intichar.json'),
  },
];

async function main() {
  for (const lesson of lessons) {
    const { data, error } = await supabase
      .from('lessons')
      .insert(lesson)
      .select();

    if (error) {
      console.error(`Error inserting "${lesson.title}":`, error.message);
    } else {
      console.log(`Inserted: "${lesson.title}" (id: ${data[0].id})`);
    }
  }
}

main().catch(console.error);
