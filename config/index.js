// ═══════════════════════════════════════════════════════════════
// إعدادات النظام — تُقرأ من متغيّرات البيئة (.env)
// لا أسرار في الكود إطلاقاً
// ═══════════════════════════════════════════════════════════════
require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  // مفتاح توقيع JWT — إلزامي في production، لا قيمة افتراضية سرّية
  JWT_SECRET: process.env.JWT_SECRET || (() => {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET غير مُعرّف! أضِفه في متغيّرات البيئة قبل التشغيل.');
    }
    console.warn('⚠️  JWT_SECRET غير مُعرّف — يُستخدم مفتاح تطوير مؤقّت (غير آمن للإنتاج)');
    return 'dev-only-insecure-secret-change-me';
  })(),
  JWT_EXPIRES: process.env.JWT_EXPIRES || '12h',
  BCRYPT_ROUNDS: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
};
