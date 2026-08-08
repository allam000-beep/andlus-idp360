// ═══════════════════════════════════════════════════════════════
// متحكّم قياس أثر التدريب
// ═══════════════════════════════════════════════════════════════
const { db } = require('../db');
const perm = require('../config/permissions');

// GET /api/impact  — كل بيانات قياس الأثر (مفتاح empId__rowId) — ضمن نطاق القارئ
function listImpact(req, res) {
  const actor = perm.loadUser(req.user.id);
  const visible = new Set(
    perm.loadAllUsers().filter(u => perm.canReadEmployee(actor, u)).map(u => u.id)
  );
  const scores = db.prepare('SELECT * FROM impact_scores').all().filter(s => visible.has(s.employee_id));
  const witnesses = db.prepare('SELECT * FROM impact_witnesses').all().filter(w => visible.has(w.employee_id));
  const result = {};
  const keyOf = (e, r) => `${e}__${r}`;
  scores.forEach(s => {
    const k = keyOf(s.employee_id, s.row_id);
    if (!result[k]) result[k] = { scores: {}, witnesses: [] };
    result[k].scores[s.item_index] = s.score;
  });
  witnesses.forEach(w => {
    const k = keyOf(w.employee_id, w.row_id);
    if (!result[k]) result[k] = { scores: {}, witnesses: [] };
    result[k].witnesses.push({ type: w.wtype, value: w.value });
  });
  res.json({ impact: result });
}

// PUT /api/impact/:employeeId/:rowId  — حفظ قياس أثر بند
// body: { scores:{idx:pct}, witnesses:[{type,value}] }
// المتابع الفني فقط (تُفرض في المسار)
function saveImpact(req, res) {
  const { employeeId, rowId } = req.params;
  const { scores = {}, witnesses = [] } = req.body || {};

  // المتابع الفني لهذا الموظف تحديداً (أو مدير النظام) — لا أيّ متابع
  const actor = perm.loadUser(req.user.id);
  const target = perm.loadUser(employeeId);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
  if (!perm.canWriteImpact(actor, target)) {
    return res.status(403).json({ error: 'لا تملك صلاحية حفظ قياس أثر هذا الموظف' });
  }

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM impact_scores WHERE employee_id=? AND row_id=?').run(employeeId, rowId);
    const insS = db.prepare('INSERT INTO impact_scores (employee_id,row_id,item_index,score) VALUES (?,?,?,?)');
    for (const idx of Object.keys(scores)) {
      const v = Number(scores[idx]);
      if (!isNaN(v)) insS.run(employeeId, rowId, Number(idx), v);
    }
    db.prepare('DELETE FROM impact_witnesses WHERE employee_id=? AND row_id=?').run(employeeId, rowId);
    const insW = db.prepare('INSERT INTO impact_witnesses (employee_id,row_id,wtype,value) VALUES (?,?,?,?)');
    (witnesses || []).forEach(w => { if (w && w.value) insW.run(employeeId, rowId, w.type || 'رابط', w.value); });
  });
  tx();
  res.json({ ok: true });
}

module.exports = { listImpact, saveImpact };
