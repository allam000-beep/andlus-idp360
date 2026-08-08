// ═══════════════════════════════════════════════════════════════
// المصادقة: تشفير كلمات المرور (bcrypt) وإصدار/تحقق الرموز (JWT)
// ═══════════════════════════════════════════════════════════════
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cfg = require('../config');

// تجزئة كلمة المرور (عند إنشاء/تعديل حساب)
async function hashPassword(plain) {
  return bcrypt.hash(plain, cfg.BCRYPT_ROUNDS);
}

// التحقق من كلمة المرور عند الدخول
async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// إصدار رمز JWT بعد الدخول الناجح
function issueToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, name: user.name },
    cfg.JWT_SECRET,
    { expiresIn: cfg.JWT_EXPIRES }
  );
}

// التحقق من الرمز (يُستخدم في middleware)
function verifyToken(token) {
  return jwt.verify(token, cfg.JWT_SECRET);
}

module.exports = { hashPassword, verifyPassword, issueToken, verifyToken };
