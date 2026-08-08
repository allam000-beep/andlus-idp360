// ═══════════════════════════════════════════════════════════════
// متحكّم المصادقة: تسجيل الدخول
// ═══════════════════════════════════════════════════════════════
const { db } = require('../db');
const { verifyPassword, hashPassword, issueToken } = require('../config/auth');
const crypto = require('crypto');
const { sendPasswordReset } = require('../config/mailer');

// إثراء بيانات المستخدم بالفروع/المراحل المتعددة (المخزّنة في جداول منفصلة)
// حرج: مدير الفرع قد يدير عدّة فروع؛ بدون هذا لا تظهر قائمة الفروع في الواجهة.
function enrichAuthUser(u) {
  if (!u) return u;
  const branches = db.prepare('SELECT branch FROM user_branches WHERE user_id = ?').all(u.id).map(r => r.branch);
  const stages = db.prepare('SELECT stage FROM user_stages WHERE user_id = ?').all(u.id).map(r => r.stage);
  let peerIds = [];
  try { peerIds = db.prepare('SELECT peer_id FROM peer_assignments WHERE employee_id = ?').all(u.id).map(r => r.peer_id); } catch (e) {}
  const { password_hash, role_subtype, ...safe } = u;
  return { ...safe, roleSubtype: role_subtype ?? u.roleSubtype ?? null, branches, stages, peerIds };
}

// POST /api/auth/login  { username, password }
async function login(req, res) {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  // رسالة موحّدة سواء المستخدم غير موجود أو كلمة المرور خاطئة (عدم كشف وجود الحساب)
  if (!user) {
    return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
  }
  // سجل تدقيق
  db.prepare('INSERT INTO audit_log (user_id, action, ip) VALUES (?, ?, ?)')
    .run(user.id, 'login', req.ip);

  const token = issueToken(user);
  // لا نُعيد password_hash إطلاقاً — ونُثري بالفروع/المراحل المتعددة
  const safeUser = enrichAuthUser(user);
  res.json({ token, user: safeUser });
}

// GET /api/auth/me  — بيانات المستخدم الحالي من الرمز
function me(req, res) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
  res.json({ user: enrichAuthUser(user) });
}

// POST /api/auth/change-password  { currentPassword, newPassword }
// يغيّر كلمة مرور المستخدم الحالي (من الرمز) بعد التحقق من الحالية
async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'كلمة المرور الحالية والجديدة مطلوبتان' });
  }
  if (String(newPassword).length < 6) {
    return res.status(400).json({ error: 'كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

  const ok = await verifyPassword(currentPassword, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة' });

  const newHash = await hashPassword(newPassword);
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
    .run(newHash, user.id);
  db.prepare('INSERT INTO audit_log (user_id, action, ip) VALUES (?,?,?)')
    .run(user.id, 'change_password', req.ip);
  res.json({ ok: true });
}

// POST /api/auth/forgot-password  { username }
// يولّد رمزاً ويرسل رابطاً لبريد الموظف (= اسم المستخدم). ردّ موحّد لعدم كشف وجود الحساب.
async function forgotPassword(req, res) {
  const { username } = req.body || {};
  const genericMsg = 'إن كان الحساب موجوداً، فسيصلك رابط إعادة التعيين على بريدك.';
  if (!username) return res.status(400).json({ error: 'اسم المستخدم (البريد) مطلوب' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (user) {
    const token = crypto.randomBytes(24).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // ساعة
    db.prepare('INSERT INTO password_resets (token, user_id, expires_at) VALUES (?,?,?)')
      .run(token, user.id, expires);
    const base = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const link = `${base}/reset-password?token=${token}`;
    try { await sendPasswordReset(user.username, link, user.name); }
    catch (e) { console.error('فشل إرسال بريد إعادة التعيين:', e.message); }
  }
  // نفس الرد دائماً
  res.json({ ok: true, message: genericMsg });
}

// POST /api/auth/reset-password  { token, newPassword }
async function resetPassword(req, res) {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) return res.status(400).json({ error: 'الرمز وكلمة المرور الجديدة مطلوبان' });
  if (String(newPassword).length < 6) return res.status(400).json({ error: 'كلمة المرور يجب ألا تقل عن 6 أحرف' });

  const row = db.prepare('SELECT * FROM password_resets WHERE token = ?').get(token);
  if (!row || row.used) return res.status(400).json({ error: 'الرابط غير صالح أو استُخدم مسبقاً' });
  if (new Date(row.expires_at) < new Date()) return res.status(400).json({ error: 'انتهت صلاحية الرابط' });

  const newHash = await hashPassword(newPassword);
  const tx = db.transaction(() => {
    db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(newHash, row.user_id);
    db.prepare('UPDATE password_resets SET used = 1 WHERE token = ?').run(token);
    db.prepare('INSERT INTO audit_log (user_id, action, ip) VALUES (?,?,?)').run(row.user_id, 'reset_password', req.ip);
  });
  tx();
  res.json({ ok: true });
}

module.exports = { login, me, changePassword, forgotPassword, resetPassword };
