// ═══════════════════════════════════════════════════════════════
// صلاحيات مستوى الكائن (من يحقّ له التصرّف في بيانات مَن)
//
// القواعد هنا منقولة حرفياً من نموذج الواجهة (AndlusIDP360.jsx):
//   getEvalModel / EVAL_RELATIONS / getEvaluators / PLAN_APPROVAL
// حتى لا يفترق الخادم عن الواجهة. أي تعديل في الواجهة يجب أن يُقابله
// تعديل هنا — فالواجهة تُخفي الأزرار، وهذا الملف هو ما يمنع فعلاً.
// ═══════════════════════════════════════════════════════════════
const { db } = require('../db');

// ─────────────────────────────────────────────────────────────
// تحميل المستخدمين بصيغة الواجهة (camelCase)
// ─────────────────────────────────────────────────────────────
const USER_COLS = 'id, name, role, role_subtype, job, branch, stage, supervisor_id, stage_manager_id';

function norm(r) {
  return {
    id: r.id, name: r.name, role: r.role, roleSubtype: r.role_subtype || null,
    job: r.job || null, branch: r.branch || null, stage: r.stage || null,
    supervisorId: r.supervisor_id || null, stageManagerId: r.stage_manager_id || null,
  };
}

function loadUser(id) {
  if (!id) return null;
  const r = db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id);
  return r ? norm(r) : null;
}

// قائمة المستخدمين تُطلب مرات كثيرة في الطلب الواحد (تحميل كل التقييمات)،
// فنحتفظ بها لثوانٍ قليلة لتفادي إعادة القراءة مع كل نداء.
let _cache = { at: 0, rows: null };
const CACHE_MS = 5000;
function loadAllUsers() {
  const now = Date.now();
  if (_cache.rows && now - _cache.at < CACHE_MS) return _cache.rows;
  const rows = db.prepare(`SELECT ${USER_COLS} FROM users`).all().map(norm);
  _cache = { at: now, rows };
  return rows;
}
// تُستدعى بعد أي تعديل على المستخدمين
function invalidateUserCache() { _cache = { at: 0, rows: null }; }

// ─────────────────────────────────────────────────────────────
// نموذج التقييم لكل دور (منقول من الواجهة)
// ─────────────────────────────────────────────────────────────
function getEvalModel(u) {
  const role = u && u.role;
  const subtype = u && u.roleSubtype;
  if (role === 'employee') return 'employee';
  if (role === 'branch_ext') return 'branch_ext';
  if (role === 'specialist') return 'specialist';
  // المتابع الفني نوعان: الوكيل-كمتابع يُقيَّم كالقيادي، والمشرف المختص (الافتراضي) كالمعلم
  if (role === 'supervisor') return subtype === 'deputy_role' ? 'leader' : 'employee';
  if (['exec', 'branch_mgr', 'stage_mgr', 'deputy', 'dept_mgr'].includes(role)) return 'leader';
  return 'employee';
}

// ─────────────────────────────────────────────────────────────
// خريطة من يقيّم من (مرؤوسون/مستفيدون) — منقولة من الواجهة
// ─────────────────────────────────────────────────────────────
const sameBranch = (a, b) => !!a.branch && a.branch === b.branch;
const sameStage = (a, b) => !!a.stage && a.stage === b.stage;
const isAdminStaff = (u) => u.role === 'employee' && (u.roleSubtype === 'admin_staff' || /إداري|موجه|مراقب|رائد|قبول/.test(u.job || ''));

const EVAL_RELATIONS = {
  'exec/ceo':             (t, c) => c.role === 'dept_mgr',
  'exec/edu_head':        (t, c) => c.role === 'branch_mgr' || (c.role === 'dept_mgr' && c.roleSubtype === 'edu_excellence'),
  'exec/admin_head':      (t, c) => c.role === 'dept_mgr' && c.roleSubtype !== 'edu_excellence' && c.roleSubtype !== 'org_excellence',
  'exec/excellence_head': (t, c) => c.role === 'specialist' && c.roleSubtype === 'org_excellence',
  'branch_mgr':           (t, c) => sameBranch(t, c) && (c.role === 'stage_mgr' || c.role === 'branch_ext'),
  'stage_mgr':            (t, c) => (sameBranch(t, c) && sameStage(t, c) && (c.role === 'deputy' || isAdminStaff(c))) || (sameBranch(t, c) && c.role === 'supervisor' && c.roleSubtype === 'specialist'),
  'deputy/students':      (t, c) => sameBranch(t, c) && sameStage(t, c) && isAdminStaff(c),
  'deputy/edu':           (t, c) => sameBranch(t, c) && c.role === 'supervisor' && c.roleSubtype === 'specialist',
  'deputy/general':       (t, c) => sameBranch(t, c) && c.role === 'supervisor' && c.roleSubtype === 'specialist',
  'dept_mgr':             (t, c) => (c.role === 'specialist' && c.roleSubtype === t.roleSubtype) || (c.role === 'branch_ext' && c.roleSubtype === t.roleSubtype),
  'branch_ext':           (t, c) => sameBranch(t, c) && (c.role === 'stage_mgr' || c.role === 'deputy'),
  'specialist':           (t, c) => (c.role === 'branch_ext' && c.roleSubtype === t.roleSubtype) || c.role === 'stage_mgr' || c.role === 'deputy',
};

// هل actor من مُقيّمي target (كمرؤوس أو مستفيد)؟
function isEvaluatorOf(actor, target) {
  if (!actor || !target || actor.id === target.id) return false;
  const key = target.roleSubtype ? `${target.role}/${target.roleSubtype}` : target.role;
  const rule = EVAL_RELATIONS[key] || EVAL_RELATIONS[target.role];
  if (!rule) return false;
  return !!rule(target, actor);
}

// ─────────────────────────────────────────────────────────────
// سلسلة اعتماد الخطط — منقولة من الواجهة
// ─────────────────────────────────────────────────────────────
const PLAN_APPROVAL = {
  'deputy':                  (t, c) => c.role === 'stage_mgr' && c.branch === t.branch && (!t.stage || c.stage === t.stage),
  'supervisor/deputy_role':  (t, c) => c.role === 'stage_mgr' && c.branch === t.branch,
  'supervisor/specialist':   (t, c) => c.role === 'branch_ext' && c.roleSubtype === 'edu_excellence' && c.branch === t.branch,
  'supervisor':              (t, c) => c.role === 'branch_ext' && c.roleSubtype === 'edu_excellence' && c.branch === t.branch,
  'stage_mgr':               (t, c) => c.role === 'branch_mgr' && c.branch === t.branch,
  'branch_mgr':              (t, c) => c.role === 'exec' && c.roleSubtype === 'edu_head',
  'dept_mgr':                (t, c) => c.role === 'exec' && (t.roleSubtype === 'edu_excellence' ? c.roleSubtype === 'edu_head' : c.roleSubtype === 'admin_head'),
  'branch_ext':              (t, c) => c.role === 'dept_mgr' && c.roleSubtype === t.roleSubtype,
  'specialist':              (t, c) => c.role === 'dept_mgr' && c.roleSubtype === t.roleSubtype,
  'exec/edu_head':           (t, c) => c.role === 'exec' && c.roleSubtype === 'ceo',
  'exec/admin_head':         (t, c) => c.role === 'exec' && c.roleSubtype === 'ceo',
  'exec/excellence_head':    (t, c) => c.role === 'exec' && c.roleSubtype === 'ceo',
};

function isPlanApproverOf(actor, target) {
  if (!actor || !target || actor.id === target.id) return false;
  const key = target.roleSubtype ? `${target.role}/${target.roleSubtype}` : target.role;
  const rule = PLAN_APPROVAL[key] || PLAN_APPROVAL[target.role];
  if (!rule) return false;
  return !!rule(target, actor);
}

// ─────────────────────────────────────────────────────────────
// علاقات مباشرة من قاعدة البيانات
// ─────────────────────────────────────────────────────────────
// هل actor زميل مُقيّم لـ target؟ (peer_assignments: من يقيّم employee_id)
function isPeerOf(actorId, targetId) {
  return !!db.prepare('SELECT 1 FROM peer_assignments WHERE employee_id = ? AND peer_id = ?').get(targetId, actorId);
}

// كل فروع/مراحل المستخدم (المفرد + المتعدد)
function branchesOf(u) {
  const multi = db.prepare('SELECT branch FROM user_branches WHERE user_id = ?').all(u.id).map(r => r.branch);
  return [...new Set([...multi, ...(u.branch ? [u.branch] : [])])];
}
function stagesOf(u) {
  const multi = db.prepare('SELECT stage FROM user_stages WHERE user_id = ?').all(u.id).map(r => r.stage);
  return [...new Set([...multi, ...(u.stage ? [u.stage] : [])])];
}

const isAdmin = (u) => !!u && u.role === 'admin';
const isDirectSupervisor = (a, t) => !!t.supervisorId && t.supervisorId === a.id;
const isDirectManager = (a, t) => !!t.stageManagerId && t.stageManagerId === a.id;

// ─────────────────────────────────────────────────────────────
// 1) الكتابة: حفظ درجات طرف معيّن
// ─────────────────────────────────────────────────────────────
// كل طرف لا يكتبه إلا صاحب العلاقة الفعلية. مدير النظام مستثنى (يدير النظام).
function canWriteEvalParty(actor, target, party) {
  if (!actor || !target) return false;
  if (isAdmin(actor)) return true;
  switch (party) {
    case 'self':        return actor.id === target.id;
    case 'peer':        return isPeerOf(actor.id, target.id);
    case 'supervisor':  return isDirectSupervisor(actor, target);
    case 'stage_mgr':   return isDirectManager(actor, target);
    case 'subordinate': return getEvalModel(target) === 'leader' && isEvaluatorOf(actor, target);
    case 'beneficiary': {
      const m = getEvalModel(target);
      return (m === 'branch_ext' || m === 'specialist') && isEvaluatorOf(actor, target);
    }
    default: return false;
  }
}

// ─────────────────────────────────────────────────────────────
// 2) القراءة: هل يرى actor بيانات target (تقييم/خطة/أثر)؟
// ─────────────────────────────────────────────────────────────
function canReadEmployee(actor, target) {
  if (!actor || !target) return false;
  if (isAdmin(actor)) return true;
  if (actor.id === target.id) return true;
  if (isDirectSupervisor(actor, target) || isDirectManager(actor, target)) return true;
  if (isPeerOf(actor.id, target.id)) return true;
  if (isEvaluatorOf(actor, target)) return true;   // مرؤوس/مستفيد يقيّمه

  switch (actor.role) {
    case 'exec':        // الإدارة التنفيذية ترى ملخّصات المنظّمة
      return true;
    case 'branch_mgr':
      return branchesOf(actor).includes(target.branch);
    case 'stage_mgr':
    case 'deputy': {
      if (!branchesOf(actor).includes(target.branch)) return false;
      const sts = stagesOf(actor);
      return sts.length ? sts.includes(target.stage) : true;
    }
    case 'dept_mgr':    // مدير إدارة وظيفية: أخصائيوها وامتداداتها
      return !!actor.roleSubtype && actor.roleSubtype === target.roleSubtype;
    default:
      return false;
  }
}

// ─────────────────────────────────────────────────────────────
// 3) خطط التطوّر: من يعدّل خطة target؟
// ─────────────────────────────────────────────────────────────
function canWriteIdp(actor, target) {
  if (!actor || !target) return false;
  if (isAdmin(actor)) return true;
  if (actor.id === target.id) return true;                       // الموظف يخطّط لنفسه
  if (isDirectSupervisor(actor, target)) return true;            // المتابع الفني يعتمد
  if (isDirectManager(actor, target)) return true;               // المدير المباشر
  if (isPlanApproverOf(actor, target)) return true;              // سلسلة الاعتماد الهرمي
  if (actor.role === 'branch_mgr' && branchesOf(actor).includes(target.branch)) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────
// 4) قياس الأثر: المتابع الفني للموظف (أو مدير النظام)
// ─────────────────────────────────────────────────────────────
function canWriteImpact(actor, target) {
  if (!actor || !target) return false;
  return isAdmin(actor) || isDirectSupervisor(actor, target);
}

// ─────────────────────────────────────────────────────────────
// 5) تعيين زملاء التقييم: إدارياً فقط (لا يختار الموظف من يقيّمه)
// ─────────────────────────────────────────────────────────────
function canManagePeers(actor, target) {
  if (!actor || !target) return false;
  if (isAdmin(actor)) return true;
  if (isDirectSupervisor(actor, target) || isDirectManager(actor, target)) return true;
  if (actor.role === 'branch_mgr' && branchesOf(actor).includes(target.branch)) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────
// 6) طلبات التعديل: المتابع يطلب، والمدير/مدير الفرع يبتّ
// ─────────────────────────────────────────────────────────────
function canWriteEditRequest(actor, target) {
  if (!actor || !target) return false;
  if (isAdmin(actor)) return true;
  if (isDirectSupervisor(actor, target) || isDirectManager(actor, target)) return true;
  if (actor.role === 'branch_mgr' && branchesOf(actor).includes(target.branch)) return true;
  return false;
}

// رقم الهوية بيانات شخصية — لا يراه إلا من له نطاق إداري على الموظف
function canSeeNationalId(actor, target) {
  if (!actor || !target) return false;
  if (isAdmin(actor) || actor.id === target.id) return true;
  if (['branch_mgr', 'stage_mgr', 'exec', 'dept_mgr'].includes(actor.role)) return canReadEmployee(actor, target);
  return false;
}

module.exports = {
  loadUser, loadAllUsers, invalidateUserCache,
  getEvalModel, isEvaluatorOf, isPlanApproverOf, isPeerOf,
  branchesOf, stagesOf, isAdmin,
  canWriteEvalParty, canReadEmployee, canWriteIdp, canWriteImpact,
  canManagePeers, canWriteEditRequest, canSeeNationalId,
};
