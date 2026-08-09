// ═══════════════════════════════════════════════════════════════
// نظام الأندلس — الخادم الرئيسي (Express)
// ═══════════════════════════════════════════════════════════════
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const cfg = require('./config');
const { db, initSchema, migrate, seedDefaults } = require('./db');
const { hashPassword } = require('./config/auth');

// تهيئة قاعدة البيانات عند الإقلاع
initSchema();
migrate();
seedDefaults();

// بذر حساب المدير تلقائياً إن لم يكن موجود (كلمة المرور من ADMIN_PASSWORD أو الافتراضية)
(async () => {
  const exists = db.prepare("SELECT 1 FROM users WHERE username='admin'").get();
  if (!exists) {
    const pass = process.env.ADMIN_PASSWORD || 'Admin@123';
    const hash = await hashPassword(pass);
    db.prepare("INSERT INTO users (id,username,password_hash,name,role) VALUES (?,?,?,?,?)")
      .run('__admin__','admin',hash,'مدير النظام','admin');
    console.log('✓ تم إنشاء حساب المدير: admin (غيّر كلمة المرور فوراً)');
  }
})();

const app = express();

// ─── حمايات أمنية ───
app.set('trust proxy', 1);              // خلف بروكسي الاستضافة (Railway)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://unpkg.com", "'unsafe-inline'"],
      styleSrc: ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
    },
  },
}));                       // رؤوس HTTP آمنة
app.use(cors({ origin: process.env.CORS_ORIGIN || true, credentials: true }));
app.use(express.json({ limit: '2mb' })); // حدّ حجم الطلب

// تحديد معدّل الطلبات (حماية من الإغراق/التخمين)
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }); // أشدّ على الدخول
app.use('/api/', apiLimiter);
app.use('/api/auth/login', loginLimiter);

// ─── المسارات ───
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/account-requests', require('./routes/accountRequests'));
app.use('/api', require('./routes/data'));
// اكتملت مسارات المنطق: evals, idps, impact, approvals, windows, settings...

// خدمة الواجهة (React المبنية) من مجلد public
app.use(express.static(path.join(__dirname, 'public')));
// ج-3: صفحة إعادة تعيين كلمة المرور (يصلها الموظف عبر رابط البريد)
app.get('/reset-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
});
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'المسار غير موجود' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// معالج أخطاء موحّد (لا يكشف تفاصيل داخلية في production)
app.use((err, req, res, next) => {
  console.error(err);
  const msg = cfg.NODE_ENV === 'production' ? 'حدث خطأ في الخادم' : err.message;
  res.status(err.status || 500).json({ error: msg });
});

app.listen(cfg.PORT, () => {
  console.log(`✓ خادم الأندلس يعمل على المنفذ ${cfg.PORT} [${cfg.NODE_ENV}]`);
});

module.exports = app;
