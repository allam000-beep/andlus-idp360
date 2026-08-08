// ═══════════════════════════════════════════════════════════════
// متحكّم المستخدمين: إنشاء/قراءة/تعديل/حذف الحسابات
// ═══════════════════════════════════════════════════════════════
const { db } = require('../db');
const { hashPassword } = require('../config/auth');
const crypto = require('crypto');
const perm = require('../config/permissions');

// يجمع الفروع/المراحل/الزملاء المتعددة لمستخدم.
// viewer: من يقرأ — يُستخدم لإخفاء رقم الهوية عمّن لا نطاق إداري له.
function enrichUser(u, viewer) {
  if (!u) return u;
  const branches = db.prepare('SELECT branch FROM user_branches WHERE user_id = ?').all(u.id).map(r => r.branch);
  const stages = db.prepare('SELECT stage FROM user_stages WHERE user_id = ?').all(u.id).map(r => r.stage);
  const peerIds = db.prepare('SELECT peer_id FROM peer_assignments WHERE employee_id = ?').all(u.id).map(r => r.peer_id);
  const { password_hash, role_subtype, national_id, ...safe } = u;
  const out = { ...safe, roleSubtype: role_subtype || null, branches, stages, peerIds };
  // رقم الهوية بيانات شخصية — لا يُعاد إلا لمن يملك نطاقاً إدارياً على الموظف
  if (!viewer || perm.canSeeNationalId(viewer, { ...u, roleSubtype: role_subtype, supervisorId: u.supervisor_id, stageManagerId: u.stage_manager_id })) {
    out.national_id = national_id;
  }
  return out;
}

// GET /api/users  — قائمة الحسابات (تحتاجها كل اللوحات للربط بين الأشخاص)
function list(req, res) {
  const viewer = perm.loadUser(req.user.id);
  const users = db.prepare('SELECT * FROM users ORDER BY name').all();
  res.json({ users: users.map(u => enrichUser(u, viewer)) });
}

// GET /api/users/:id
function getOne(req, res) {
  const viewer = perm.loadUser(req.user.id);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'المستخدم غير موجود' });
  res.json({ user: enrichUser(u, viewer) });
}

// POST /api/users  — إنشاء حساب (للمدير)
async function create(req, res) {
  const b = req.body || {};
  if (!b.username || !b.password || !b.name || !b.role) {
    return res.status(400).json({ error: 'الحقول الأساسية مطلوبة (اسم المستخدم، كلمة المرور، الاسم، الدور)' });
  }
  const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(b.username);
  if (exists) return res.status(409).json({ error: 'اسم المستخدم مستخدم مسبقاً' });

  const id = b.id || crypto.randomUUID();
  const hash = await hashPassword(b.password);

  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO users
      (id, username, password_hash, name, national_id, role, role_subtype, job, branch, stage, supervisor_type, supervisor_id, stage_manager_id)
      VALUES (@id,@username,@password_hash,@name,@national_id,@role,@role_subtype,@job,@branch,@stage,@supervisor_type,@supervisor_id,@stage_manager_id)`)
      .run({
        id, username: b.username, password_hash: hash, name: b.name,
        national_id: b.nationalId || null, role: b.role, role_subtype: b.roleSubtype || null, job: b.job || null,
        branch: b.branch || null, stage: b.stage || null,
        supervisor_type: b.supervisorType || null,
        supervisor_id: b.supervisorId || null, stage_manager_id: b.stageManagerId || null,
      });
    syncMulti(id, b);
  });
  tx();
  perm.invalidateUserCache();   // تغيّرت العلاقات → أبطِل ذاكرة الصلاحيات
  db.prepare('INSERT INTO audit_log (user_id, action, detail, ip) VALUES (?,?,?,?)')
    .run(req.user.id, 'create_user', id, req.ip);
  res.status(201).json({ user: enrichUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)) });
}

// PUT /api/users/:id  — تعديل حساب
async function update(req, res) {
  const id = req.params.id;
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: 'المستخدم غير موجود' });
  const b = req.body || {};

  // كلمة المرور تُحدَّث فقط إن أُرسلت (وإلا تبقى كما هي)
  let hash = u.password_hash;
  if (b.password && b.password.trim()) hash = await hashPassword(b.password);

  const tx = db.transaction(() => {
    db.prepare(`UPDATE users SET
      name=@name, national_id=@national_id, role=@role, role_subtype=@role_subtype, job=@job,
      branch=@branch, stage=@stage, supervisor_type=@supervisor_type,
      supervisor_id=@supervisor_id, stage_manager_id=@stage_manager_id,
      password_hash=@password_hash, updated_at=datetime('now')
      WHERE id=@id`)
      .run({
        id, name: b.name ?? u.name, national_id: b.nationalId ?? u.national_id,
        role: b.role ?? u.role, role_subtype: b.roleSubtype ?? u.role_subtype, job: b.job ?? u.job, branch: b.branch ?? u.branch,
        stage: b.stage ?? u.stage, supervisor_type: b.supervisorType ?? u.supervisor_type,
        supervisor_id: b.supervisorId ?? u.supervisor_id,
        stage_manager_id: b.stageManagerId ?? u.stage_manager_id,
        password_hash: hash,
      });
    if (b.branches !== undefined || b.stages !== undefined || b.peerIds !== undefined) syncMulti(id, b);
  });
  tx();
  perm.invalidateUserCache();   // تغيّرت العلاقات → أبطِل ذاكرة الصلاحيات
  db.prepare('INSERT INTO audit_log (user_id, action, detail, ip) VALUES (?,?,?,?)')
    .run(req.user.id, 'update_user', id, req.ip);
  res.json({ user: enrichUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)) });
}

// PUT /api/users/:id/peers — تعيين زملاء التقييم (للمقيّمين/مدراء الفروع)
function assignPeers(req, res) {
  const id = req.params.id;
  const u = db.prepare('SELECT 1 FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: 'المستخدم غير موجود' });

  // تعيين المُقيّمين قرار إداري — لا يختار الموظف من يقيّمه
  const actor = perm.loadUser(req.user.id);
  const target = perm.loadUser(id);
  if (!perm.canManagePeers(actor, target)) {
    return res.status(403).json({ error: 'لا تملك صلاحية تعيين زملاء التقييم لهذا الموظف' });
  }

  const peerIds = Array.isArray(req.body.peerIds) ? req.body.peerIds : [];
  db.prepare('DELETE FROM peer_assignments WHERE employee_id=?').run(id);
  const ins = db.prepare('INSERT OR IGNORE INTO peer_assignments (employee_id,peer_id) VALUES (?,?)');
  peerIds.forEach(pid => pid && ins.run(id, pid));
  db.prepare('INSERT INTO audit_log (user_id, action, detail, ip) VALUES (?,?,?,?)')
    .run(req.user.id, 'assign_peers', id, req.ip);
  res.json({ ok: true });
}

// DELETE /api/users/:id
function remove(req, res) {
  const id = req.params.id;
  const u = db.prepare('SELECT 1 FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: 'المستخدم غير موجود' });

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM users WHERE id = ?').run(id);  // CASCADE يحذف المرتبطات
    // eval_locks/readings/approvals مفاتيحها نصّية مركّبة (empId__…) لا مفاتيح أجنبية،
    // فلا يطالها CASCADE. نحذفها يدوياً وإلا بقيت أبداً — والأخطر أنّ إعادة استيراد
    // موظف بنفس المعرّف (أداة الترحيل تُبقي المعرّفات) كانت سترث أقفال "تم" القديمة.
    // ملاحظة: '_' محرف بدل في LIKE، فنهرّبه بـ ESCAPE وإلا طابق أيّ محرف.
    db.prepare("DELETE FROM eval_locks WHERE lock_key = ? OR lock_key LIKE ? ESCAPE '\\' OR lock_key LIKE ? ESCAPE '\\'")
      .run(id, id + '\\_\\_%', '%\\_\\_peer\\_\\_' + id);
    db.prepare("DELETE FROM readings  WHERE reading_key = ? OR reading_key LIKE ? ESCAPE '\\'").run(id, id + '\\_\\_%');
    db.prepare("DELETE FROM approvals WHERE approval_key = ? OR approval_key LIKE ? ESCAPE '\\'").run(id, id + '\\_\\_%');
  });
  tx();
  perm.invalidateUserCache();
  db.prepare('INSERT INTO audit_log (user_id, action, detail, ip) VALUES (?,?,?,?)')
    .run(req.user.id, 'delete_user', id, req.ip);
  res.json({ ok: true });
}

// يزامن الفروع/المراحل/الزملاء المتعددة
function syncMulti(id, b) {
  if (b.branches !== undefined) {
    db.prepare('DELETE FROM user_branches WHERE user_id=?').run(id);
    const ins = db.prepare('INSERT OR IGNORE INTO user_branches (user_id,branch) VALUES (?,?)');
    (b.branches || []).forEach(br => br && ins.run(id, br));
  }
  if (b.stages !== undefined) {
    db.prepare('DELETE FROM user_stages WHERE user_id=?').run(id);
    const ins = db.prepare('INSERT OR IGNORE INTO user_stages (user_id,stage) VALUES (?,?)');
    (b.stages || []).forEach(s => s && ins.run(id, s));
  }
  if (b.peerIds !== undefined) {
    db.prepare('DELETE FROM peer_assignments WHERE employee_id=?').run(id);
    const ins = db.prepare('INSERT OR IGNORE INTO peer_assignments (employee_id,peer_id) VALUES (?,?)');
    (b.peerIds || []).forEach(pid => pid && ins.run(id, pid));
  }
}

module.exports = { list, getOne, create, update, remove, assignPeers };
