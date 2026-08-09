// ═══════════════════════════════════════════════════════════════
// متحكّم موحّد: الاعتمادات، النوافذ، طلبات التعديل، الدورات،
// التقييم المزدوج، القراءات، والإعدادات المشتركة
// ═══════════════════════════════════════════════════════════════
const { db } = require('../db');
const perm = require('../config/permissions');

// ─── الاعتمادات (approvals) ───
function getApprovals(req, res) {
  const rows = db.prepare('SELECT * FROM approvals').all();
  const out = {};
  rows.forEach(r => { out[r.approval_key] = { approved: !!r.approved, approvedAt: r.approved_at }; });
  res.json({ approvals: out });
}
function setApproval(req, res) {
  const { key, approved } = req.body || {};
  if (!key) return res.status(400).json({ error: 'المفتاح مطلوب' });
  if (approved === false) {
    db.prepare('DELETE FROM approvals WHERE approval_key=?').run(key);
  } else {
    db.prepare("INSERT OR REPLACE INTO approvals (approval_key,approved,approved_at) VALUES (?,1,datetime('now'))").run(key);
  }
  res.json({ ok: true });
}

// ─── نوافذ التقييم (eval_windows) ───
function getWindows(req, res) {
  const rows = db.prepare('SELECT * FROM eval_windows').all();
  const branches = {};
  rows.forEach(r => { branches[r.branch] = { isOpen: !!r.is_open, openDate: r.open_date, closeDate: r.close_date }; });
  res.json({ branches });
}
function setWindow(req, res) {
  const { branch, isOpen, openDate, closeDate } = req.body || {};
  if (!branch) return res.status(400).json({ error: 'الفرع مطلوب' });
  // ملاحظة: نستخدم معاملات مسمّاة فقط (لا نخلط ? مع @) — الخلط يرمي خطأً في better-sqlite3
  db.prepare(`INSERT INTO eval_windows (branch,is_open,open_date,close_date)
    VALUES (@branch,@io,@od,@cd)
    ON CONFLICT(branch) DO UPDATE SET is_open=@io, open_date=@od, close_date=@cd`)
    .run({ branch, io: isOpen ? 1 : 0, od: openDate || null, cd: closeDate || null });
  res.json({ ok: true });
}

// ─── طلبات التعديل (edit_requests) ───
function getEditRequests(req, res) {
  const rows = db.prepare('SELECT * FROM edit_requests').all();
  const out = {};
  rows.forEach(r => { out[r.employee_id] = { status: r.status, rowId: r.row_id, note: r.note, requestedAt: r.requested_at }; });
  res.json({ editRequests: out });
}
function setEditRequest(req, res) {
  const { employeeId, status, rowId, note } = req.body || {};
  if (!employeeId) return res.status(400).json({ error: 'الموظف مطلوب' });

  // المتابع/المدير المباشر/مدير الفرع/مدير النظام فقط
  const actor = perm.loadUser(req.user.id);
  const target = perm.loadUser(employeeId);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
  if (!perm.canWriteEditRequest(actor, target)) {
    return res.status(403).json({ error: 'لا تملك صلاحية طلب تعديل لهذا الموظف' });
  }
  if (status === null) {
    db.prepare('DELETE FROM edit_requests WHERE employee_id=?').run(employeeId);
  } else {
    db.prepare(`INSERT INTO edit_requests (employee_id,status,row_id,note) VALUES (?,?,?,?)
      ON CONFLICT(employee_id) DO UPDATE SET status=@s, row_id=@r, note=@n`)
      .run(employeeId, status || 'pending', rowId || null, note || null,
           { s: status || 'pending', r: rowId || null, n: note || null });
  }
  res.json({ ok: true });
}

// ─── التقييم المزدوج (twice_eval) ───
function getTwice(req, res) {
  const rows = db.prepare('SELECT employee_id FROM twice_eval').all();
  res.json({ twice: rows.map(r => r.employee_id) });
}
// ب-4: حالة التقييم الثاني (تُخزَّن كإعداد مشترك)
function getRound2(req, res) {
  const row = db.prepare("SELECT value FROM settings WHERE skey='round2'").get();
  res.json(row ? JSON.parse(row.value) : { open: false });
}
function setRound2(req, res) {
  db.prepare("INSERT OR REPLACE INTO settings (skey,value) VALUES ('round2',?)").run(JSON.stringify(req.body || { open: false }));
  res.json({ ok: true });
}
function setTwice(req, res) {
  const { list } = req.body || {};
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM twice_eval').run();
    const ins = db.prepare('INSERT OR IGNORE INTO twice_eval (employee_id) VALUES (?)');
    (list || []).forEach(id => ins.run(id));
  });
  tx();
  res.json({ ok: true });
}

// ─── الدورات الحضورية الداخلية (internal_courses) ───
function getCourses(req, res) {
  const rows = db.prepare('SELECT * FROM internal_courses').all();
  const out = {};
  rows.forEach(r => { out[`${r.course_name}__${r.employee_id}`] = { actualDate: r.actual_date, attendance: r.attendance }; });
  res.json({ courses: out });
}
function setCourse(req, res) {
  const { courseName, employeeId, actualDate, attendance } = req.body || {};
  if (!courseName || !employeeId) return res.status(400).json({ error: 'اسم الدورة والموظف مطلوبان' });
  db.prepare(`INSERT INTO internal_courses (course_name,employee_id,actual_date,attendance) VALUES (?,?,?,?)
    ON CONFLICT(course_name,employee_id) DO UPDATE SET actual_date=@ad, attendance=@at`)
    .run(courseName, employeeId, actualDate || null, attendance || null,
         { ad: actualDate || null, at: attendance || null });
  res.json({ ok: true });
}

// ─── القراءات (readings) ───
function getReadings(req, res) {
  const rows = db.prepare('SELECT reading_key, read_at FROM readings').all();
  const out = {};
  rows.forEach(r => { out[r.reading_key] = r.read_at; });
  res.json({ readings: out });
}
function setReading(req, res) {
  const { key } = req.body || {};
  if (!key) return res.status(400).json({ error: 'المفتاح مطلوب' });
  db.prepare("INSERT OR REPLACE INTO readings (reading_key,read_at) VALUES (?,datetime('now'))").run(key);
  res.json({ ok: true });
}

// ─── الإعدادات المشتركة (settings) ───
function getSettings(req, res) {
  const rows = db.prepare('SELECT skey, value FROM settings').all();
  const out = {};
  rows.forEach(r => { try { out[r.skey] = JSON.parse(r.value); } catch { out[r.skey] = null; } });
  res.json({ settings: out });
}
function setSetting(req, res) {
  const { key, value } = req.body || {};
  if (!key) return res.status(400).json({ error: 'المفتاح مطلوب' });
  db.prepare('INSERT OR REPLACE INTO settings (skey,value) VALUES (?,?)').run(key, JSON.stringify(value));
  res.json({ ok: true });
}

module.exports = {
  getApprovals, setApproval, getWindows, setWindow,
  getEditRequests, setEditRequest, getTwice, setTwice,
  getRound2, setRound2,
  getCourses, setCourse, getReadings, setReading,
  getSettings, setSetting,
};
