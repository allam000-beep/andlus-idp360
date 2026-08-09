// ═══════════════════════════════════════════════════════════════
// متحكّم خطط التطور المهني (IDP)
// ═══════════════════════════════════════════════════════════════
const { db } = require('../db');
const crypto = require('crypto');
const perm = require('../config/permissions');

// GET /api/idps/:employeeId
function getIdp(req, res) {
  const empId = req.params.employeeId;
  const actor = perm.loadUser(req.user.id);
  const target = perm.loadUser(empId);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
  if (!perm.canReadEmployee(actor, target)) return res.json({ idp: null, rows: [] });

  const head = db.prepare('SELECT * FROM idps WHERE employee_id = ?').get(empId);
  const rows = db.prepare('SELECT * FROM idp_rows WHERE employee_id = ? ORDER BY sort_order').all(empId);
  res.json({ idp: head || null, rows });
}

// GET /api/idps  — كل الخطط (للتقارير الإدارية) — مقصورة على نطاق القارئ
function listIdps(req, res) {
  const actor = perm.loadUser(req.user.id);
  const visible = new Set(
    perm.loadAllUsers().filter(u => perm.canReadEmployee(actor, u)).map(u => u.id)
  );

  const heads = db.prepare('SELECT * FROM idps').all().filter(h => visible.has(h.employee_id));
  const allRows = db.prepare('SELECT * FROM idp_rows ORDER BY sort_order').all().filter(r => visible.has(r.employee_id));
  const byEmp = {};
  heads.forEach(h => { byEmp[h.employee_id] = { ...h, plan: [] }; });
  allRows.forEach(r => {
    if (!byEmp[r.employee_id]) byEmp[r.employee_id] = { employee_id: r.employee_id, plan: [] };
    byEmp[r.employee_id].plan.push(mapRow(r));
  });
  res.json({ idps: byEmp });
}

// PUT /api/idps/:employeeId  — حفظ الخطة كاملة (رأس + بنود)
// body: { approved, approvedBy, approvedAt, needsBranchApproval, ..., plan:[rows] }
function saveIdp(req, res) {
  const empId = req.params.employeeId;
  const b = req.body || {};
  const plan = Array.isArray(b.plan) ? b.plan : [];

  // الخطة يكتبها صاحبها، أو متابعه/مديره المباشر، أو معتمِدها في السلسلة الهرمية
  const actor = perm.loadUser(req.user.id);
  const target = perm.loadUser(empId);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
  if (!perm.canWriteIdp(actor, target)) {
    return res.status(403).json({ error: 'لا تملك صلاحية تعديل خطة هذا الموظف' });
  }

  const tx = db.transaction(() => {
    // رأس الخطة
    db.prepare(`INSERT INTO idps (employee_id, approved, approved_by, approved_at, needs_branch_approval, branch_approved_at, edit_unlocked, edit_unlocked_row, is_final, certificate, updated_at)
      VALUES (@employee_id,@approved,@approved_by,@approved_at,@needs_branch_approval,@branch_approved_at,@edit_unlocked,@edit_unlocked_row,@is_final,@certificate,datetime('now'))
      ON CONFLICT(employee_id) DO UPDATE SET
        approved=@approved, approved_by=@approved_by, approved_at=@approved_at,
        needs_branch_approval=@needs_branch_approval, branch_approved_at=@branch_approved_at,
        edit_unlocked=@edit_unlocked, edit_unlocked_row=@edit_unlocked_row, is_final=@is_final, certificate=@certificate, updated_at=datetime('now')`)
      .run({
        employee_id: empId,
        approved: b.approved ? 1 : 0,
        approved_by: b.approvedBy || null,
        approved_at: b.approvedAt || null,
        needs_branch_approval: b.needsBranchApproval ? 1 : 0,
        branch_approved_at: b.branchApprovedAt || null,
        edit_unlocked: b.editUnlocked ? 1 : 0,
        edit_unlocked_row: b.editUnlockedRow || null,
        is_final: b.isFinal ? 1 : 0,
        certificate: b.certificate ? JSON.stringify(b.certificate) : null,
      });

    // البنود: نحذف القديمة ونُدرج الجديدة (أبسط وأضمن للاتساق)
    db.prepare('DELETE FROM idp_rows WHERE employee_id = ?').run(empId);
    const ins = db.prepare(`INSERT INTO idp_rows
      (id, employee_id, cat, comp, need_source, train_method, program_name, provider, url, cost, hours, target_date, eval_method, status, sort_order)
      VALUES (@id,@employee_id,@cat,@comp,@need_source,@train_method,@program_name,@provider,@url,@cost,@hours,@target_date,@eval_method,@status,@sort_order)`);
    plan.forEach((r, i) => {
      ins.run({
        id: r.id || crypto.randomUUID(),
        employee_id: empId,
        cat: r.cat || null, comp: r.comp || null,
        need_source: r.needSource || null, train_method: r.trainMethod || null,
        program_name: r.programName || null, provider: r.provider || null,
        url: r.url || null, cost: r.cost || null, hours: r.hours || null,
        target_date: r.targetDate || null, eval_method: r.evalMethod || null,
        status: r.status || 'لم يتم التنفيذ', sort_order: i,
      });
    });
  });
  tx();
  res.json({ ok: true });
}

// يحوّل صف قاعدة البيانات لصيغة الواجهة (camelCase)
function mapRow(r) {
  return {
    id: r.id, cat: r.cat, comp: r.comp, needSource: r.need_source,
    trainMethod: r.train_method, programName: r.program_name, provider: r.provider,
    url: r.url, cost: r.cost, hours: r.hours, targetDate: r.target_date,
    evalMethod: r.eval_method, status: r.status,
  };
}

module.exports = { getIdp, listIdps, saveIdp };
