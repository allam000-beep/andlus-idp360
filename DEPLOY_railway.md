# دليل النشر على Railway — نظام الأندلس

دليل عملي خطوة بخطوة لنشر النظام (Node.js + SQLite) على Railway من مجلد المشروع على جهازك.
كل أمر هنا مُجرَّب فعلياً على هذا المشروع.

**ما ستحصل عليه في النهاية:** رابط عام يعمل، قاعدة بيانات على قرص دائم لا تُفقد عند النشر،
ومتغيّرات بيئة مضبوطة.

---

## المتطلّبات

| المتطلّب | الملاحظة |
|---------|----------|
| حساب Railway | https://railway.com |
| Node.js على جهازك | **أيّ إصدار حديث يكفي** — يلزم فقط لتشغيل أداة Railway وتوليد مفتاح JWT |
| Railway CLI | يُثبَّت في الخطوة 1 |

> ### ⚠️ إصدار Node على الخادم — لا تعبث به
> **هذا لا علاقة له بإصدار Node على جهازك.** Railway يقرأ `engines` من `package.json`
> ويبني به، وقيمته مثبّتة على `"node": "20.x"` لسبب جوهري:
>
> الحزمة `better-sqlite3` وحدة أصلية (native) تُبنى عند التثبيت. و**npm 11**
> (المرفق مع Node 24) يحجب سكربتات التثبيت افتراضياً، فلا تُبنى الحزمة ويسقط
> التطبيق عند الإقلاع برسالة عن وحدة مفقودة.
>
> **لا تُغيّر `engines` في `package.json`** إلا وأنت متأكّد من تبعات ذلك.

---

## الخطوة 1 — تثبيت الأداة وتسجيل الدخول

```bash
npm i -g @railway/cli
```

```bash
railway login
```

يفتح المتصفح لتأكيد الدخول. للتأكّد:

```bash
railway whoami
```

---

## الخطوة 2 — لا تحتاج تجهيزاً محلياً

**تخطَّ هذه الخطوة وانتقل للخطوة 3.** المشروع جاهز للنشر كما هو:

- **لا تحتاج `npm install`** — يرفع `railway up` الشيفرة المصدرية فقط
  (مجلد `node_modules` مستثنى في `.gitignore`)، وRailway ينفّذ `npm ci` بنفسه على الخادم.
- **لا تحتاج خطوة بناء للواجهة** — `public/app.bundle.js` مبنيّ ومرفق مسبقاً.
  لا تشغّل `npm run build:ui` إلا إن عدّلت `AndlusIDP360.jsx`.
- **لا تحتاج ملف `.env`** — المتغيّرات تُضبط على Railway في الخطوة 4.

الشيء الوحيد المطلوب على جهازك هو **Node.js** (لتشغيل أداة Railway وتوليد مفتاح JWT).

> **ماذا تخسر بتخطّي التجربة المحلية؟** لا شيء جوهري — لكن أي خطأ سيظهر في سجلّ
> Railway بدل طرفيتك. الخطوة 6 تشرح كيف تقرأ السجلّ، والخطوة 8 كيف تتحقّق أن كل شيء يعمل.
> إن أردت التجربة المحلية لاحقاً فهي في **الملحق** آخر هذا الملف.

---

## الخطوة 3 — إنشاء المشروع وربطه بالمجلد

**إن لم يكن لديك مشروع على Railway:**

```bash
railway init --name Tranning_app
```

**إن كان المشروع موجوداً مسبقاً** (اربط المجلد به):

```bash
railway link --project Tranning_app --environment production
```

للتأكّد من الارتباط:

```bash
railway status
```

---

## الخطوة 4 — إنشاء الخدمة مع متغيّرات البيئة

ولّد مفتاح JWT عشوائياً أولاً (**إلزامي** — التطبيق يرفض الإقلاع في الإنتاج بدونه):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

انسخ الناتج وضعه مكان `<المفتاح>` في الأمر التالي:

```bash
railway add --service andlus-app --variables "NODE_ENV=production" --variables "JWT_SECRET=<المفتاح>" --variables "JWT_EXPIRES=12h" --variables "BCRYPT_ROUNDS=12" --variables "CORS_ORIGIN=true" --variables "DB_PATH=/data/andlus.db"
```

ثم **اربط الخدمة بالمجلد** — خطوة ضرورية، وبدونها تفشل أوامر القرص في الخطوة التالية:

```bash
railway service link andlus-app
```

### شرح المتغيّرات

| المتغيّر | الغرض |
|---------|-------|
| `JWT_SECRET` | توقيع رموز الدخول. **إلزامي**، ولا تشاركه |
| `DB_PATH=/data/andlus.db` | يضع القاعدة داخل القرص الدائم |
| `BCRYPT_ROUNDS=12` | قوة تجزئة كلمات المرور |
| `CORS_ORIGIN` | `true` = اسمح للكل. ضع نطاقك لتشديد الأمان |
| `ADMIN_PASSWORD` | اختياري: كلمة مرور المدير عند أول إنشاء فقط |
| `RATE_LIMIT_LOGIN` | اختياري (افتراضي 30) محاولة دخول **فاشلة** لكل حساب/15د |
| `RATE_LIMIT_API` | اختياري (افتراضي 20000) طلب لكل عنوان/15د |

---

## الخطوة 5 — القرص الدائم (Volume) ⚠️ لا تتخطَّ هذه

SQLite ملف على القرص. قرص Railway الافتراضي **مؤقّت**: كل نشر جديد يمسح البيانات.

```bash
railway volume add --mount-path /data
```

> لاحظ: الأمر **لا يقبل** `--service`؛ يستخدم الخدمة المرتبطة في الخطوة 4.

للتأكّد:

```bash
railway volume list --json
```

يجب أن ترى `"mountPath": "/data"` و `"status": "Ready"`.
تأكّد أن `DB_PATH` يبدأ بـ `/data/` وإلا فالقاعدة خارج القرص وستُفقد.

---

## الخطوة 6 — النشر

```bash
railway up --ci
```

يرفع الشيفرة، ويبني الصورة، ويشغّلها. `--ci` يعرض سجلّ البناء مباشرة في طرفيتك —
وهذا **بديلك عن التجربة المحلية**، فاقرأه ولا تتجاهله.

### أ) سجلّ البناء (يظهر أثناء تنفيذ الأمر)

ابحث عن سطر تثبيت التبعيات. النجاح:

```
[stage-0 6/8] RUN npm ci
added 124 packages
...
Deploy complete
```

إن فشل البناء عند `better-sqlite3` فالسبب إصدار Node — راجع تحذير المتطلّبات.

### ب) سجلّ التشغيل (بعد اكتمال البناء)

```bash
railway logs --lines 30
```

الإقلاع الناجح يبدو هكذا:

```
✓ تمّت تهيئة مخطّط قاعدة البيانات
✓ بُذرت الإعدادات الافتراضية
✓ خادم الأندلس يعمل على المنفذ 8080 [production]
✓ تم إنشاء حساب المدير: admin (غيّر كلمة المرور فوراً)
```

> السطر الأخير يظهر **مرّة واحدة فقط** عند أول إقلاع. غيابه في عمليات النشر التالية
> دليل جيّد على أن القرص الدائم يعمل وأن القاعدة قديمة لا جديدة.

إن رأيت `JWT_SECRET غير مُعرّف` فالمتغيّر ناقص — راجع الخطوة 4.
وللتأكّد من حالة النشر:

```bash
railway deployment list --json
```

انتظر `"status": "SUCCESS"`.

---

## الخطوة 7 — الرابط العام

```bash
railway domain
```

يُعيد رابطاً مثل `https://andlus-app-production.up.railway.app`.
أضِفه كمتغيّر (يُستخدم في روابط إعادة تعيين كلمة المرور) — وهذا يُعيد النشر تلقائياً:

```bash
railway variables --set "APP_BASE_URL=https://<رابطك>"
```

---

## الخطوة 8 — التحقّق

```bash
railway deployment list --json
```

انتظر `"status": "SUCCESS"`، ثم افتح الرابط وسجّل الدخول بـ `admin` / `Admin@123`.

**اختبار ثبات القرص (مهم):** أنشئ حساباً تجريبياً، ثم:

```bash
railway redeploy --yes
```

إن بقي الحساب بعد إعادة النشر فالقرص يعمل. إن اختفى فراجع الخطوة 5.

---

## الخطوة 9 — إدخال البيانات

النظام يبدأ فارغاً: بلا جدارات ولا مسميات وظيفية ولا مصادر، فتظهر القوائم فارغة.
هذا **طبيعي** — لا يوجد محتوى مدمج في الكود. أمامك ثلاثة طرق:

### أ) إدخال يدوي
من «🗂️ مصفوفة الجدارات» و«📖 مكتبة المصادر» و«👥 الحسابات».

### ب) نقل قاعدة موجودة عبر واجهة التطبيق (يحفظ كل شيء عدا كلمات المرور)

```bash
node scripts/restore_to_server.js <مسار.db> <الرابط> admin <كلمة_مرور_المدير>
```

يعمل **جافّاً** بلا كتابة. أضِف `--apply` للتنفيذ الفعلي، ثم تحقّق:

```bash
node scripts/verify_restore.js <مسار.db> <الرابط> admin <كلمة_مرور_المدير>
```

> كلمات المرور مخزَّنة مُجزّأة ولا تُنقل عبر الـ API، فتُضبط `Andlus@2026` لكل حساب مُستعاد.

### ج) رفع ملف القاعدة مباشرة (يحفظ كلمات المرور أيضاً)

```bash
railway volume files --volume andlus-app-volume upload <مسار.db> /andlus.db --overwrite
```

```bash
railway volume files --volume andlus-app-volume delete /andlus.db-wal --yes
```

```bash
railway volume files --volume andlus-app-volume delete /andlus.db-shm --yes
```

```bash
railway redeploy --yes
```

> ⚠️ **حذف `-wal` و`-shm` إلزامي.** هما ملفّان مرافقان للقاعدة القديمة،
> وتركهما مع قاعدة جديدة **يُفسد البيانات**.
> جهّز الملف أولاً بدمج الـ WAL بداخله: `PRAGMA wal_checkpoint(TRUNCATE)` ثم `VACUUM INTO`.

---

## الخطوة 10 — الأمان بعد النشر (لا تؤجّلها)

1. **غيّر كلمة مرور `admin` فوراً** من «🔑 كلمة المرور». الافتراضية `Admin@123` معروفة لكل من يرى ملفات المشروع.
2. اطلب من كل مستخدم تغيير كلمته عند أول دخول.
3. خذ نسخة احتياطية دورية:

```bash
railway volume files --volume andlus-app-volume download /andlus.db ./backup.db
```

4. لتشديد CORS ضع نطاقك بدل `true`:

```bash
railway variables --set "CORS_ORIGIN=https://<رابطك>"
```

---

## استكشاف الأخطاء

| العَرَض | السبب والحل |
|--------|-------------|
| البناء يفشل عند `better-sqlite3` | إصدار Node. تأكّد أن `package.json` فيه `"node": "20.x"` |
| `JWT_SECRET غير مُعرّف` عند الإقلاع | أضِفه: `railway variables --set "JWT_SECRET=..."` |
| البيانات تختفي بعد كل نشر | لا يوجد قرص دائم، أو `DB_PATH` لا يبدأ بـ `/data/` — راجع الخطوة 5 |
| `error: unexpected argument '--service'` | `railway volume add` لا يقبلها. نفّذ `railway service link andlus-app` أولاً |
| `No linked project found` | نفّذ `railway link` داخل مجلد المشروع |
| رسالة «خطأ في الخادم» عند الدخول | تجاوز حدّ المحاولات. ارفع `RATE_LIMIT_LOGIN` أو انتظر 15 دقيقة |
| القوائم فارغة (المسمى الوظيفي مثلاً) | لا توجد بيانات — راجع الخطوة 9. ليست مشكلة برمجية |
| الواجهة لا تعكس تعديلاتك | ارفع رقم الإصدار في `public/index.html` (`?v=`) واعمل `Ctrl+Shift+R` |
| نصّ عربي مشوّه عند الإرسال من PowerShell | PowerShell يُفسد ترميز العربية. استخدم سكربت Node بدلاً منه |

---

## أوامر مرجعية

```bash
railway status                      # حالة الارتباط الحالي
railway variables                   # عرض المتغيّرات
railway logs --lines 50             # سجلّ التشغيل
railway up --ci                     # نشر
railway redeploy --yes              # إعادة نشر بلا رفع جديد
railway domain                      # الرابط العام
railway volume list --json          # حالة القرص
railway open                        # فتح لوحة التحكّم
```

---

## بديل: النشر عبر GitHub

إن فضّلت النشر التلقائي عند كل `git push`:

1. ارفع المشروع إلى مستودع GitHub (`.env` و`*.db` مستثنيان في `.gitignore`).
2. في لوحة Railway: **New Project → Deploy from GitHub repo**.
3. أضِف المتغيّرات والقرص كما في الخطوتين 4 و5.

أو من الطرفية:

```bash
railway service source connect --repo <owner>/<repo> --branch main --service andlus-app
```

---

## ملحق: التشغيل المحلي (اختياري تماماً)

لا يلزم للنشر إطلاقاً. مفيد فقط إن أردت تعديل الشيفرة أو تجربة تغيير قبل رفعه.

```bash
npm install
```

> إن ظهر تحذير `allow-scripts` بخصوص `better-sqlite3`، نفّذ:
> `npm approve-scripts better-sqlite3` ثم `npm rebuild better-sqlite3`

```bash
node -e "process.env.JWT_SECRET='test';process.env.DB_PATH='./tmp/local.db';require('./app.js')"
```

افتح `http://localhost:3000` وسجّل الدخول بـ `admin` / `Admin@123`.

نسخة محلية منفصلة تماماً عن الإنتاج: قاعدتها في `./tmp/local.db` (وهي مستثناة في
`.gitignore` فلا تُرفع). لإعادة البدء من الصفر احذف مجلد `tmp` وأعد التشغيل.
