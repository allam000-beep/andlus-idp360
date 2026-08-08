// ═══════════════════════════════════════════════════════════════
// حماية المسارات: التحقق من رمز الدخول والصلاحيات حسب الدور
// ═══════════════════════════════════════════════════════════════
const { verifyToken } = require('../config/auth');

// يتطلّب رمز دخول صالحاً — يُرفق req.user
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'مطلوب تسجيل الدخول' });
  try {
    req.user = verifyToken(token);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'رمز الدخول غير صالح أو منتهٍ' });
  }
}

// يتطلّب دوراً محدّداً (أو أكثر)
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'مطلوب تسجيل الدخول' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'لا تملك صلاحية لهذا الإجراء' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
