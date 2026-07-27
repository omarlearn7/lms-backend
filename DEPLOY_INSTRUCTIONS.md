# تعليمات النشر — E-Learning LMS

**آخر تحديث:** Mon Jul 27 2026

---

## معلومات الوصول

### GitHub
- **المستخدم:** `omarlearn7`
- **CLI Auth:** مسجل الدخول في `/tmp/opencode/gh`
- **المستودعات:**
  - `omarlearn7/lms-frontend` → `/home/o/websites/E-learning/lms-frontend`
  - `omarlearn7/lms-backend` → `/home/o/websites/E-learning/lms-backend`

### Supabase
- **Project ID:** `yvucoankgtvpbxirnvih`
- **URL:** `https://yvucoankgtvpbxirnvih.supabase.co`

### Cloudflare
- **Pages Project:** `lms-frontend`
- **الرابط الحالي:** `https://2dedb8ae.lms-frontend-4nk.pages.dev`

### Backend (Render)
- **الرابط:** `https://lms-backend-vg1s.onrender.com`

### R2 Storage
- **Account ID:** `6125140724b83a0f69ebe41f7effc336`

---

## خطوات النشر

### Frontend (Cloudflare Pages)

```bash
# 1. بناء المشروع
cd /home/o/websites/E-learning/lms-frontend
npm run build

# 2. رفع التعديلات إلى GitHub
git add -A
git commit -m "وصف التغييرات"
git push origin main

# 3. نشر على Cloudflare Pages
npx wrangler pages deploy dist --project-name=lms-frontend
```

### Backend (Render)

```bash
# 1. رفع التعديلات إلى GitHub
cd /home/o/websites/E-learning/lms-backend
git add -A
git commit -m "وصف التغييرات"
git push origin main

# 2. Render يقوم تلقائياً بنشر التحديثات عند الرفع إلى main
#    أو يدوياً من خلال لوحة تحكم Render:
#    https://dashboard.render.com → lms-backend-vg1s → Manual Deploy → Deploy latest commit
```

### Migration على Supabase

```bash
# تشغيل migration يدوياً عبر Supabase Dashboard:
# 1. افتح https://supabase.com/dashboard
# 2. اختر المشروع → SQL Editor
# 3. الصق محتوى المigration (مثل migrations/08_lessons.sql)
# 4. اضغط Run
```

### إدراج درس جديد

```bash
cd /home/o/websites/E-learning/lms-backend
node scripts/insert-lesson.js \
  --folder ../lessons/chemistry-fundamentals \
  --category "الكيمياء" \
  --author-id " USER_UUID_HERE " \
  --grade 3 \
  --free
```

---

## ملاحظات مهمة

- **Flutter Pages:** اسم المشروع في Cloudflare هو `lms-frontend` (ليس `lms-frontend-4nk`)
- **الـ slug بالعربي:** نظام الـ slug يدعم الأحرف العربية تلقائياً
- **محتوى الدروس:** يُخزّن في `sections` (وليس `blocks`) داخل `content_json`
- **الأمان:** لا ترفع `.env` أو مفاتيح API إلى GitHub أبداً
- **الـ BFG:** تم تنظيف Git history بالفعل — لا تُعدّ لرفع كلمات مرور قديمة
