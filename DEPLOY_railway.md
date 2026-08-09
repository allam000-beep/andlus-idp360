# دليل النشر على Railway — نظام الأندلس

دليل خطوة بخطوة لتثبيت النظام على استضافة Railway (Node.js + SQLite).

## المتطلّبات
- حساب على Railway (https://railway.com/).
- Node.js 18+ للبناء المحلي.
- ملف `andlus_export.json` من أداة الترحيل (اختياري).

---

## الخطوة 1: تجهيز المشروع محلياً
```bash
npm install
# ضع ملف AndlusIDP360.jsx في جذر المشروع ثم:
npm run build:ui
```
بعدها يصبح `public/app.bundle.js` جاهزاً.

## الخطوة 2: متغيّرات البيئة
```bash
cp .env.example .env
# ولّد مفتاح JWT قوياً:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
# ضع الناتج في JWT_SECRET داخل .env
```

## الخطوة 3: بذر حساب المدير
```bash
node scripts/seed_admin.js      # admin / Admin@123 (غيّرها فوراً)
```

## الخطوة 4: (اختياري) ترحيل البيانات
```bash
npm run migrate -- path/to/andlus_export.json
```
لاستخراج الملف: افتح `migration/export.html` في المتصفح القديم واضغط "تصدير".

## الخطوة 5: الرفع على Railway

**أ) عبر GitHub (موصى به):**
1. ارفع المشروع لمستودع GitHub (`.env` و `*.db` مستثنيان تلقائياً).
2. Railway → New Project → Deploy from GitHub repo.

**ب) متغيّرات البيئة في Railway → Variables:**
```
NODE_ENV=production
JWT_SECRET=<المفتاح المولّد>
JWT_EXPIRES=12h
BCRYPT_ROUNDS=12
```

**ج) قرص دائم للبيانات (مهم جداً!):**
SQLite ملف على القرص. بلا قرص دائم تُفقد البيانات عند كل نشر:
1. Railway → Volumes → New Volume.
2. اربطه بمسار `/data`.
3. أضِف متغيّراً: `DB_PATH=/data/andlus.db`

## الخطوة 6: التشغيل
Railway يشغّل `npm start` تلقائياً. افتح الرابط وسجّل الدخول.

---

## بعد النشر
1. غيّر كلمة مرور المدير فوراً.
2. بعد الترحيل: أبلغ المستخدمين بكلمة المرور الافتراضية وطالبهم بتغييرها.
3. فعّل النسخ الاحتياطي الدوري لملف `/data/andlus.db`.

## استكشاف الأخطاء
| المشكلة | الحل |
|---------|------|
| خطأ JWT_SECRET عند الإقلاع | أضِفه في Variables |
| البيانات تُفقد بعد النشر | اربط Volume (خطوة 5-ج) |
| الواجهة بيضاء | شغّل `npm run build:ui` |
| better-sqlite3 فشل | تأكّد Node 18+ (Railway يبنيه تلقائياً) |
