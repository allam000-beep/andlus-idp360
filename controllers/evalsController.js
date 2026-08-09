// ═══════════════════════════════════════════════════════════════
// متحكّم تقييم الأداء 360°
// يشمل: حفظ درجات كل طرف، منطق تقييم الزملاء المتعدّد وإخفاء الهوية
// ═══════════════════════════════════════════════════════════════
const { db } = require('../db');
const perm = require('../config/permissions');

const PEER_MIN_RATERS = 2;   // لا تظهر درجة الزملاء إلا بمُقيّمَين فأكثر

// هيكل تقييم فارغ — يُعاد لمن لا يملك صلاحية القراءة على هذا الموظف.
// (لا نُعيد 403 لأن الواجهة تحمّل تقييمات كل المستخدمين دفعةً واحدة،
//  فرفض واحد يُسقط التحميل كلّه. الفارغ = «لا شيء تراه هنا».)
const EMPTY_EVAL = () => ({
  eval: { self: {}, peer: {}, supervisor: {}, stage_mgr: {}, subordinate: {}, beneficiary: {} },
  peerCount: 0, subordinateCount: 0, beneficiaryCount: 0,
});

// ─── قراءة تقييم موظف (كل الأطراف) ───
// GET /api/evals/:employeeId
// تُعيد الدرجات منظّمة: { self:{comp:{idx:score}}, peer:{...avg}, supervisor:{...}, stage_mgr:{...} }
// مع peerRaters (التفصيل) فقط لمن يملك صلاحية (المديرون)
function getEmployeeEval(req, res) {
  const empId = req.params.employeeId;

  // صلاحية القراءة: صاحب البيانات، أو من له علاقة تقييم/إشراف عليه
  const actor = perm.loadUser(req.user.id);
  const target = perm.loadUser(empId);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
  if (!perm.canReadEmployee(actor, target)) return res.json(EMPTY_EVAL());

  const rows = db.prepare('SELECT party, rater_id, round, comp_key, item_index, score FROM eval_scores WHERE employee_id = ?').all(empId);

  const ANON = ['peer','subordinate','beneficiary'];
  // نبني الجولتين منفصلتين
  const build = (roundRows) => {
    const result = { self:{}, peer:{}, supervisor:{}, stage_mgr:{}, subordinate:{}, beneficiary:{} };
    const raters = { peer:{}, subordinate:{}, beneficiary:{} };
    for (const r of roundRows) {
      if (ANON.includes(r.party)) {
        const R = raters[r.party];
        if (!R[r.rater_id]) R[r.rater_id] = {};
        if (!R[r.rater_id][r.comp_key]) R[r.rater_id][r.comp_key] = {};
        R[r.rater_id][r.comp_key][r.item_index] = r.score;
      } else {
        if (!result[r.party][r.comp_key]) result[r.party][r.comp_key] = {};
        result[r.party][r.comp_key][r.item_index] = r.score;
      }
    }
    ANON.forEach(p => { result[p] = computePeerAvg(raters[p]); });
    return { result, raters };
  };

  const r1 = build(rows.filter(r => (r.round || 1) === 1));
  const r2rows = rows.filter(r => r.round === 2);
  const result = r1.result;
  const raters = r1.raters;

  // ب-4: إن وُجدت درجات جولة ثانية، نضيفها تحت __r2 (نفس بنية الواجهة)
  if (r2rows.length) {
    const r2 = build(r2rows);
    result.__r2 = r2.result;
  }

  const canSeeDetail = ['stage_mgr', 'branch_mgr', 'admin'].includes(req.user.role);
  const payload = { eval: result };
  if (canSeeDetail) {
    payload.peerRaters = raters.peer;
    payload.subordinateRaters = raters.subordinate;
    payload.beneficiaryRaters = raters.beneficiary;
  }
  payload.peerCount = Object.keys(raters.peer).length;
  payload.subordinateCount = Object.keys(raters.subordinate).length;
  payload.beneficiaryCount = Object.keys(raters.beneficiary).length;

  res.json(payload);
}

// حساب متوسط تقييمات الزملاء لكل بند (لا يظهر بند قيّمه أقل من الحد)
function computePeerAvg(peerRaters) {
  const raterIds = Object.keys(peerRaters);
  const result = {};
  const comps = new Set();
  raterIds.forEach(rid => Object.keys(peerRaters[rid]).forEach(ck => comps.add(ck)));
  comps.forEach(ck => {
    const byItem = {};
    raterIds.forEach(rid => {
      const cs = peerRaters[rid][ck] || {};
      Object.keys(cs).forEach(idx => {
        const v = Number(cs[idx]);
        if (v > 0) (byItem[idx] = byItem[idx] || []).push(v);
      });
    });
    const itemAvgs = {};
    Object.keys(byItem).forEach(idx => {
      const arr = byItem[idx];
      if (arr.length >= PEER_MIN_RATERS)
        itemAvgs[idx] = Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100;
    });
    if (Object.keys(itemAvgs).length) result[ck] = itemAvgs;
  });
  return result;
}

// ─── حفظ تقييم طرف ───
// POST /api/evals/:employeeId
// body: { party, scores:{comp:{idx:score}}, witnesses:{comp:text}, raterId? }
// للزملاء: raterId = المستخدم الحالي (يؤخذ من الرمز، لا يُوثق به من الطلب)
function saveEval(req, res) {
  const empId = req.params.employeeId;
  const { party, scores = {}, witnesses = {}, round = 1 } = req.body || {};
  // كل الأطراف الستّة مقبولة الآن (كان المرؤوسون/المستفيدون مرفوضين)
  if (!['self', 'peer', 'supervisor', 'stage_mgr', 'subordinate', 'beneficiary'].includes(party)) {
    return res.status(400).json({ error: 'طرف تقييم غير صالح' });
  }
  const rnd = Number(round) === 2 ? 2 : 1;

  // صلاحية الكتابة: لا يُكتب طرف إلا من صاحب العلاقة الفعلية به.
  // (الواجهة تُخفي الأزرار، وهذا ما يمنع فعلاً عند استدعاء الـ API مباشرة.)
  const actor = perm.loadUser(req.user.id);
  const target = perm.loadUser(empId);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
  if (!perm.canWriteEvalParty(actor, target, party)) {
    return res.status(403).json({ error: 'لا تملك صلاحية تقييم هذا الموظف بهذه الصفة' });
  }

  // الأطراف مجهولة الهوية متعددة المُقيّمين: نميّز بمُقيّم. البقية rater_id = null
  const ANON = ['peer', 'subordinate', 'beneficiary'];
  const raterId = ANON.includes(party) ? req.user.id : null;

  const tx = db.transaction(() => {
    // نحذف درجات هذا الطرف لنفس الجولة (وهذا المُقيّم للأطراف المجهولة) ثم نُدرج الجديدة
    if (ANON.includes(party)) {
      db.prepare('DELETE FROM eval_scores WHERE employee_id=? AND party=? AND rater_id=? AND round=?').run(empId, party, raterId, rnd);
    } else {
      db.prepare('DELETE FROM eval_scores WHERE employee_id=? AND party=? AND round=?').run(empId, party, rnd);
    }
    const ins = db.prepare('INSERT INTO eval_scores (employee_id,party,rater_id,round,comp_key,item_index,score) VALUES (?,?,?,?,?,?,?)');
    for (const comp of Object.keys(scores)) {
      for (const idx of Object.keys(scores[comp])) {
        const v = Number(scores[comp][idx]);
        if (v > 0) ins.run(empId, party, raterId, rnd, comp, Number(idx), v);
      }
    }
    // الشواهد (للمتابع/المدير المباشر) — الجولة الأولى فقط للتبسيط
    if ((party === 'supervisor' || party === 'stage_mgr') && rnd === 1) {
      const insW = db.prepare('INSERT OR REPLACE INTO eval_witnesses (employee_id,party,comp_key,witness_text) VALUES (?,?,?,?)');
      for (const comp of Object.keys(witnesses)) {
        if (witnesses[comp]) insW.run(empId, party, comp, witnesses[comp]);
      }
    }
  });
  tx();
  res.json({ ok: true });
}

// ─── قفل التقييم (حفظ نهائي = "تم") ───
// POST /api/evals/:employeeId/lock  body:{ party, raterId? }
function lockEval(req, res) {
  const empId = req.params.employeeId;
  const { party } = req.body || {};

  // القفل حفظ نهائي — نفس صلاحية الكتابة لذلك الطرف
  const actor = perm.loadUser(req.user.id);
  const target = perm.loadUser(empId);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
  if (!perm.canWriteEvalParty(actor, target, party)) {
    return res.status(403).json({ error: 'لا تملك صلاحية إغلاق تقييم هذا الموظف' });
  }

  const raterId = party === 'peer' ? req.user.id : null;
  const key = party === 'peer' ? `${empId}__peer__${raterId}` : `${empId}__${party}`;
  db.prepare('INSERT OR REPLACE INTO eval_locks (lock_key, locked_at) VALUES (?, datetime(\'now\'))').run(key);
  res.json({ ok: true, lockKey: key });
}

// ─── قراءة كل الأقفال (لحساب حالات "تم") ───
// GET /api/evals/locks
function getLocks(req, res) {
  const rows = db.prepare('SELECT lock_key, locked_at FROM eval_locks').all();
  const locks = {};
  rows.forEach(r => { locks[r.lock_key] = { lockedAt: r.locked_at }; });
  res.json({ locks });
}

module.exports = { getEmployeeEval, saveEval, lockEval, getLocks };
