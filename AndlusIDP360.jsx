import React, { useState, useEffect, useMemo } from "react";

const MONO='IBM Plex Mono';
const LogoImg = ({style, size=17}) => (
  <div style={{display:"flex",alignItems:"center",justifyContent:"center",...style}}>
  <div style={{fontSize:size,fontWeight:900,color:"#1D5A8A",letterSpacing:0.3,lineHeight:1.2,textAlign:"center",whiteSpace:"nowrap"}}>شركة الأندلس التعليمية</div>
  </div>
);

let COMPETENCIES_WITH_ITEMS = {};
let JOB_COMPETENCIES = {};

const initSharedData = async () => {
  const safeGet = async (k, shared) => {
  try { const r = await window.storage.get(k, shared); return r?.value ? JSON.parse(r.value) : null; }
  catch { return null; }
  };
  const [sc, sj, ss, sm, sw, sri] = await Promise.all([
  safeGet("customComps_360c", true),
  safeGet("customJobs_360c", true),
  safeGet("customSources_360c", true),
  safeGet("customSourceMap_360c", true),
  safeGet("customWeights_360c", true),
  safeGet("compRoleItems_360c", true),
  ]);
  if (sc) { COMPETENCIES_WITH_ITEMS = sc; _activeComps = sc; }
  if (sj) { JOB_COMPETENCIES = sj; _activeJobs = sj; }
  if (ss) { _activeSources = ss; }
  if (sm) { _activeCompMap = sm; }
  if (sw) {
    _activeWeights = sw;
    // دعم الصيغتين: القديمة (طرف→فئات، للنموذج employee فقط) والجديدة (4 نماذج)
    if (sw.employee || sw.leader || sw.specialist || sw.branch_ext) applyCustomWeights(sw);
    else applyCustomWeights({ employee: sw });
  }
  if (sri) { _compRoleItems = sri; }
};


const PARTY_CATS = {
  self:        ["أساسية","عامة","فنية"],
  peer:        ["أساسية"],
  supervisor:  ["عامة","فنية"],
  stage_mgr:   ["أساسية"],
  subordinate: ["عامة"],      // المرؤوسون يقيّمون رئيسهم (بنود عامة يحدّدها مدير النظام)
  beneficiary: ["عامة"],      // المستفيدون من الخدمة (بنود عامة)
};

const DEFAULT_WEIGHTS = {
  peer:       { أساسية: 5,  عامة: 0,  فنية: 0  },
  supervisor: { أساسية: 0,  عامة: 30, فنية: 15 },
  stage_mgr:  { أساسية: 45, عامة: 0,  فنية: 0  },
};
const SELF_WEIGHT = 5;
let _activeWeights = JSON.parse(JSON.stringify(DEFAULT_WEIGHTS));
const getActiveWeights = () => _activeWeights;
const setActiveWeights = (d) => { _activeWeights = d; };
const PARTY_CAT_WEIGHTS = new Proxy({}, { get: (_, party) => _activeWeights[party] || {} });

// ═══ سجل نماذج التقييم الأربعة (د-4) ═══
// كل نموذج: الأطراف وأوزانها والفئات التي يقيّمها كل طرف.
// الأطراف الممكنة: self, peer, supervisor, stage_mgr (المدير المباشر), subordinate (المرؤوسون), beneficiary (المستفيدون)
const EVAL_MODELS = {
  // اللوحة 1: معلم/إداري/مشرف مختص — أوزان مفصّلة لكل فئة (أساسية/عامة/فنية)
  employee: {
    parties: {
      self:       { catWeights: { أساسية:2,  عامة:2,  فنية:1  } },   // مجموع 5
      peer:       { catWeights: { أساسية:5,  عامة:0,  فنية:0  } },   // مجموع 5
      supervisor: { catWeights: { أساسية:0,  عامة:30, فنية:15 } },   // مجموع 45
      stage_mgr:  { catWeights: { أساسية:45, عامة:0,  فنية:0  } },   // مجموع 45
    },
  },
  // اللوحة 2: مدير مرحلة/مجمع/وكيل/مساعد إداري/مدير إدارة وظيفية/إدارة تنفيذية
  leader: {
    parties: {
      self:        { catWeights: { أساسية:2,  عامة:2,  فنية:1  } },  // 5
      stage_mgr:   { catWeights: { أساسية:25, عامة:25, فنية:25 } },  // 75
      subordinate: { catWeights: { أساسية:10, عامة:5,  فنية:5  } },  // 20
    },
  },
  // اللوحة 4: امتداد فني لإدارة وظيفية — ذاتي 5 + متابع فني 40 + مدير مباشر 45 + مستفيدون 10
  branch_ext: {
    parties: {
      self:        { catWeights: { أساسية:2,   عامة:2,   فنية:1   } }, // 5
      supervisor:  { catWeights: { أساسية:0,   عامة:0,   فنية:40  } }, // 40
      stage_mgr:   { catWeights: { أساسية:25,  عامة:20,  فنية:0   } }, // 45
      beneficiary: { catWeights: { أساسية:5,   عامة:2.5, فنية:2.5 } }, // 10
    },
  },
  // اللوحة 3: أخصائي إدارة وظيفية — ذاتي 5 + مدير مباشر 80 + مستفيدون 15
  specialist: {
    parties: {
      self:        { catWeights: { أساسية:2,  عامة:2,  فنية:1  } },  // 5
      stage_mgr:   { catWeights: { أساسية:30, عامة:25, فنية:25 } },  // 80
      beneficiary: { catWeights: { أساسية:7,  عامة:4,  فنية:4  } },  // 15
    },
  },
};
// مشتقّ للتوافق: قائمة الفئات التي يقيّمها كل طرف (وزنها > 0)
Object.values(EVAL_MODELS).forEach(m => {
  Object.values(m.parties).forEach(p => {
    p.cats = Object.entries(p.catWeights).filter(([,w])=>w>0).map(([c])=>c);
    p.weight = Object.values(p.catWeights).reduce((s,w)=>s+w,0);
  });
});
// نسخة افتراضية للاسترجاع
const DEFAULT_EVAL_MODELS = JSON.parse(JSON.stringify(EVAL_MODELS));
// تطبيق أوزان مخصّصة (من مدير النظام) على النماذج الأربعة
// الشكل: { employee: { self:{أساسية,عامة,فنية}, ... }, leader:{...}, ... }
const applyCustomWeights = (cw) => {
  if (!cw) return;
  Object.entries(cw).forEach(([modelKey, parties]) => {
    if (!EVAL_MODELS[modelKey]) return;
    Object.entries(parties||{}).forEach(([party, catW]) => {
      if (!EVAL_MODELS[modelKey].parties[party]) return;
      EVAL_MODELS[modelKey].parties[party].catWeights = { ...catW };
    });
    // نعيد اشتقاق cats وweight
    Object.values(EVAL_MODELS[modelKey].parties).forEach(p => {
      p.cats = Object.entries(p.catWeights).filter(([,w])=>w>0).map(([c])=>c);
      p.weight = Object.values(p.catWeights).reduce((s,w)=>s+(Number(w)||0),0);
    });
  });
};
// تصدير الأوزان الحالية بشكل قابل للتحرير (4 نماذج)
const exportModelWeights = () => {
  const out = {};
  Object.entries(EVAL_MODELS).forEach(([mk,m]) => {
    out[mk] = {};
    Object.entries(m.parties).forEach(([party,def]) => { out[mk][party] = { ...def.catWeights }; });
  });
  return out;
};

// يحدّد نموذج التقييم حسب دور الموظف
const getEvalModel = (roleOrUser) => {
  // يقبل إمّا سلسلة الدور أو كائن المستخدم (لتمييز المتابع الفني حسب نوعه الفرعي)
  const role = typeof roleOrUser === "string" ? roleOrUser : roleOrUser?.role;
  const subtype = typeof roleOrUser === "object" ? roleOrUser?.roleSubtype : null;
  if (role === "employee") return "employee";
  if (role === "branch_ext") return "branch_ext";
  if (role === "specialist") return "specialist";
  // المتابع الفني نوعان: الوكيل-كمتابع (deputy_role) يُقيَّم كالقيادي، وغيره (المشرف المختص) كالمعلم
  // الافتراضي = المشرف المختص (الأشيع)، فلا يُعامَل كوكيل إلا إن حُدّد نوعه deputy_role صراحةً
  if (role === "supervisor") {
    return subtype === "deputy_role" ? "leader" : "employee";
  }
  // القيادي: exec, branch_mgr, stage_mgr, deputy, dept_mgr
  if (["exec","branch_mgr","stage_mgr","deputy","dept_mgr"].includes(role)) return "leader";
  return "employee"; // افتراضي آمن
};

// ب-4/إصلاح البطاقة: أطراف التقييم الفعلية لدور معيّن (حسب نموذجه فقط)
// يقبل سلسلة الدور أو كائن المستخدم (لتمييز نوع المتابع الفني)
const partiesForRole = (roleOrUser) => {
  const model = EVAL_MODELS[getEvalModel(roleOrUser)];
  return model ? Object.keys(model.parties) : [];
};

// تسميات الأطراف حسب النموذج (للعرض)
const PARTY_LABELS = {
  self:"التقييم الذاتي", peer:"زملاء التخصص", supervisor:"المتابع الفني",
  stage_mgr:"المدير المباشر", subordinate:"المرؤوسون", beneficiary:"المستفيدون",
};
const PARTY_ICONS = { self:"👤", peer:"🤝", supervisor:"🔍", stage_mgr:"🏛️", subordinate:"⬆️", beneficiary:"🎯" };

// ═══ خريطة علاقات التقييم الصاعد/المستفيدين (د-5) ═══
// لكل وظيفة (تُقيَّم): شرط تحديد من يقيّمها. النطاق افتراضياً نفس الفرع (sameBranch) إلا إذا ذُكر allBranches.
// match(target, candidate) => هل candidate يقيّم target؟
const EVAL_RELATIONS = {
  // القيادي: مرؤوسون
  "exec/ceo":        (t,c)=> c.role==="dept_mgr",                                  // مدراء الإدارات الوظيفية
  "exec/edu_head":   (t,c)=> c.role==="branch_mgr" || (c.role==="dept_mgr"&&c.roleSubtype==="edu_excellence"),
  "exec/admin_head": (t,c)=> c.role==="dept_mgr"&&c.roleSubtype!=="edu_excellence"&&c.roleSubtype!=="org_excellence",
  "exec/excellence_head": (t,c)=> c.role==="specialist"&&c.roleSubtype==="org_excellence",
  "branch_mgr":      (t,c)=> sameBranch(t,c)&&(c.role==="stage_mgr"||c.role==="branch_ext"),
  "stage_mgr":       (t,c)=> sameBranch(t,c)&&sameStage(t,c)&&(c.role==="deputy"||isAdminStaff(c)) || (sameBranch(t,c)&&c.role==="supervisor"&&c.roleSubtype==="specialist"),
  "deputy/students": (t,c)=> sameBranch(t,c)&&sameStage(t,c)&&isAdminStaff(c),
  "deputy/edu":      (t,c)=> sameBranch(t,c)&&c.role==="supervisor"&&c.roleSubtype==="specialist",
  "deputy/general":  (t,c)=> sameBranch(t,c)&&c.role==="supervisor"&&c.roleSubtype==="specialist",
  // مدراء الإدارات الوظيفية: أخصائيو الإدارة + الامتدادات الفنية المناظرة في الفروع (مطابقة بالتخصص)
  "dept_mgr":        (t,c)=> (c.role==="specialist"&&c.roleSubtype===t.roleSubtype) || (c.role==="branch_ext"&&c.roleSubtype===t.roleSubtype),
  // الامتداد الفني: يقيّمه مدراء ووكلاء مراحل فرعه (مستفيدون)
  "branch_ext":      (t,c)=> sameBranch(t,c)&&(c.role==="stage_mgr"||c.role==="deputy"),
  // الأخصائي: يقيّمه الامتداد الفني المناظر في كل الفروع + وكلاء/مدراء المراحل (مستفيدون)
  "specialist":      (t,c)=> (c.role==="branch_ext"&&c.roleSubtype===t.roleSubtype) || c.role==="stage_mgr" || c.role==="deputy",
};
// دوال مساعدة للمطابقة
function sameBranch(a,b){ return a.branch && a.branch===b.branch; }
function sameStage(a,b){ return a.stage && a.stage===b.stage; }
function isAdminStaff(u){ return u.role==="employee" && (u.roleSubtype==="admin_staff" || /إداري|موجه|مراقب|رائد|قبول/.test(u.job||"")); }

// يُرجع قائمة المُقيّمين (مرؤوسين/مستفيدين) لشخص معيّن، حسب الخريطة
const getEvaluators = (target, allUsers) => {
  if (!target) return [];
  const key = target.roleSubtype ? `${target.role}/${target.roleSubtype}` : target.role;
  // نبحث عن قاعدة مطابقة: أولاً بالمفتاح الكامل، ثم بالدور وحده
  const rule = EVAL_RELATIONS[key] || EVAL_RELATIONS[target.role];
  if (!rule) return [];
  return (allUsers||[]).filter(c => c.id!==target.id && rule(target, c));
};

// ═══ سلسلة الاعتماد الهرمي لخطط التطوّر (د-7) ═══
// من يعتمد خطة كل قيادي؟ يُرجع دالة مطابقة للمعتمِد، أو null (يعتمده مدير الفرع افتراضياً)
const PLAN_APPROVAL = {
  // الوكلاء والمتابعون كوكلاء: اعتماد فني من مدير المرحلة، ثم تجميع عند مدير الفرع
  "deputy":       (t,c)=> c.role==="stage_mgr" && c.branch===t.branch && (!t.stage || c.stage===t.stage),
  // المتابع الفني نوعان: الوكيل-كمتابع → مدير المرحلة؛ المشرف المختص → المشرف التعليمي (امتداد فني تعليمي)
  "supervisor/deputy_role": (t,c)=> c.role==="stage_mgr" && c.branch===t.branch,
  "supervisor/specialist":  (t,c)=> c.role==="branch_ext" && c.roleSubtype==="edu_excellence" && c.branch===t.branch,
  // احتياط لمن بلا نوع فرعي: الافتراضي = المشرف المختص → يعتمده المشرف التعليمي (لا مدير المرحلة)
  "supervisor":   (t,c)=> c.role==="branch_ext" && c.roleSubtype==="edu_excellence" && c.branch===t.branch,
  // مدير المرحلة: يعتمده مدير الفرع (كمدير مباشر)
  "stage_mgr":    (t,c)=> c.role==="branch_mgr" && c.branch===t.branch,
  // مدير الفرع: يعتمده مدير الشؤون التعليمية
  "branch_mgr":   (t,c)=> c.role==="exec" && c.roleSubtype==="edu_head",
  // مدير إدارة التميز التعليمي ← مدير الشؤون التعليمية؛ باقي الإدارات ← مدير الشؤون الإدارية
  "dept_mgr":     (t,c)=> c.role==="exec" && (t.roleSubtype==="edu_excellence" ? c.roleSubtype==="edu_head" : c.roleSubtype==="admin_head"),
  // الامتداد الفني والأخصائي: مدير إدارتهم الوظيفية
  "branch_ext":   (t,c)=> c.role==="dept_mgr" && c.roleSubtype===t.roleSubtype,
  "specialist":   (t,c)=> c.role==="dept_mgr" && c.roleSubtype===t.roleSubtype,
  // مديرو الشؤون ومدير التميز المؤسسي: يعتمدهم الرئيس التنفيذي
  "exec/edu_head":        (t,c)=> c.role==="exec" && c.roleSubtype==="ceo",
  "exec/admin_head":      (t,c)=> c.role==="exec" && c.roleSubtype==="ceo",
  "exec/excellence_head": (t,c)=> c.role==="exec" && c.roleSubtype==="ceo",
};
// يُرجع المعتمِد لخطة شخص (أو null إن لم تُعرَّف قاعدة)
const getPlanApprover = (target, allUsers) => {
  if (!target) return null;
  const key = target.roleSubtype ? `${target.role}/${target.roleSubtype}` : target.role;
  const rule = PLAN_APPROVAL[key] || PLAN_APPROVAL[target.role];
  if (!rule) return null;
  return (allUsers||[]).find(c => c.id!==target.id && rule(target, c)) || null;
};
// وصف نصّي للمعتمِد (للعرض حين لا يوجد حساب فعلي بعد)
const PLAN_APPROVER_LABEL = {
  "deputy":"مدير المرحلة (اعتماد فني) ثم مدير الفرع", "supervisor":"المشرف التعليمي (الامتداد الفني التعليمي)",
  "stage_mgr":"مدير الفرع", "branch_mgr":"مدير الشؤون التعليمية",
  "dept_mgr":"مدير الشؤون التعليمية/الإدارية", "branch_ext":"مدير الإدارة الوظيفية", "specialist":"مدير الإدارة الوظيفية",
  "exec/edu_head":"الرئيس التنفيذي", "exec/admin_head":"الرئيس التنفيذي", "exec/excellence_head":"الرئيس التنفيذي",
};

// ═══ نطاق ملخّص الأداء الهرمي (د-8) ═══
// يُرجع قائمة المستخدمين الذين يظهرون في ملخّص أداء قيادي معيّن.
const EDU_DEPTS = ["edu_excellence"];                         // إدارة التميز التعليمي
const ORG_DEPTS = ["org_excellence"];                         // إدارة التميز المؤسسي
const getSummaryScope = (viewer, allUsers) => {
  if (!viewer) return [];
  const key = viewer.roleSubtype ? `${viewer.role}/${viewer.roleSubtype}` : viewer.role;
  const all = allUsers || [];
  switch (key) {
    case "exec/ceo": // الرئيس التنفيذي: الكل
      return all.filter(u => u.id!==viewer.id && u.role!=="admin");
    case "exec/edu_head": // الشؤون التعليمية: كل الفروع + إدارة التميز التعليمي
      return all.filter(u => isBranchStaff(u) || isInDept(u, EDU_DEPTS));
    case "exec/admin_head": // الشؤون الإدارية: كل الإدارات الوظيفية وامتداداتها عدا التميزين
      return all.filter(u => (u.role==="dept_mgr"||u.role==="specialist"||u.role==="branch_ext") && !isInDept(u,EDU_DEPTS) && !isInDept(u,ORG_DEPTS));
    case "exec/excellence_head": // التخطيط والتميز المؤسسي: موظفو إدارة التميز المؤسسي
      return all.filter(u => isInDept(u, ORG_DEPTS));
    default:
      return [];
  }
};
// موظف تابع لفرع (لا لإدارة وظيفية مركزية)
function isBranchStaff(u){ return ["branch_mgr","stage_mgr","deputy","supervisor","employee","branch_ext"].includes(u.role); }
// هل المستخدم ضمن إدارة وظيفية من قائمة أنواع معيّنة؟
function isInDept(u, subtypes){ return (u.role==="dept_mgr"||u.role==="specialist"||u.role==="branch_ext") && subtypes.includes(u.roleSubtype); }


const ALL_SOURCES = [];
const COMP_SOURCES_MAP = {};
let _activeSources = ALL_SOURCES;
let _activeCompMap = COMP_SOURCES_MAP;
const getActiveSources = () => _activeSources;
const getActiveCompMap = () => _activeCompMap;
const setActiveSources = (d) => { _activeSources = d; };
const setActiveCompMap = (d) => { _activeCompMap = d; };
const buildSourceMap = (sources) => { const m={}; (sources||[]).forEach(s=>{ if(s.name) m[s.name.trim()]=s; }); return m; };
const getSourceInfo = (name) => { const map=buildSourceMap(_activeSources); const t=(name||"").trim(); return map[t]||_activeSources.find(s=>s.name.replace(/\s+/g," ").trim()===t.replace(/\s+/g," "))||null; };
const IDP_MATRIX = new Proxy({}, { get:(_,key)=>getActiveCompMap()[key]||[], has:(_,key)=>key in getActiveCompMap(), ownKeys:()=>Object.keys(getActiveCompMap()) });

let _activeComps = null;
let _activeJobs  = null;
const getActiveComps = () => _activeComps || COMPETENCIES_WITH_ITEMS;

// ═══ تعليم بنود المرؤوسين/المستفيدين (د-6) ═══
// البنية: { "اسم الجدارة": { subordinate:[أرقام البنود], beneficiary:[أرقام البنود] } }
let _compRoleItems = {};
const getCompRoleItems = () => _compRoleItems;
const setCompRoleItems = (d) => { _compRoleItems = d || {}; };
// هل البند (جدارة، رقم) معلّم لطرف معيّن؟
const isItemFor = (comp, idx, party) => {
  const arr = _compRoleItems[comp]?.[party] || [];
  return arr.includes(idx);
};
// بنود جدارة معيّنة المعلّمة لطرف (subordinate/beneficiary)
const itemsFor = (comp, party) => _compRoleItems[comp]?.[party] || [];
const getActiveJobs  = () => _activeJobs  || JOB_COMPETENCIES;
const setActiveComps = (d) => { _activeComps = d; };
const setActiveJobs  = (d) => { _activeJobs  = d; };

const getCat = c => getActiveComps()[c]?.cat || "عامة";

const calcCompScore = (compKey, itemScores) => {
  const items = getActiveComps()[compKey]?.items || [];
  if (!items.length) return null;
  const scored = items.map((_, i) => itemScores?.[i] || 0).filter(s => s > 0);
  if (!scored.length) return null;
  return scored.reduce((a,b)=>a+b,0) / items.length;
};

const PEER_MIN_RATERS = 2;
const computePeerAvg = (raters) => {
  const raterIds = Object.keys(raters||{});
  const result = {};
  const comps = new Set();
  raterIds.forEach(rid=>Object.keys(raters[rid]||{}).forEach(ck=>comps.add(ck)));
  comps.forEach(ck=>{
  const itemAvgs = {};
  const byItem = {};
  raterIds.forEach(rid=>{
   const cs = raters[rid]?.[ck]||{};
   Object.keys(cs).forEach(idx=>{ const v=Number(cs[idx]); if(v>0){ (byItem[idx]=byItem[idx]||[]).push(v); } });
  });
  Object.keys(byItem).forEach(idx=>{
   const arr=byItem[idx];
   if(arr.length>=PEER_MIN_RATERS) itemAvgs[idx]=Math.round((arr.reduce((a,b)=>a+b,0)/arr.length)*100)/100;
  });
  if(Object.keys(itemAvgs).length) result[ck]=itemAvgs;
  });
  return result;
};

const getWitnesses = (empEval) => {
  const result = [];
  ["supervisor","stage_mgr"].forEach(party=>{
  const partyData = empEval?.[party] || {};
  const witnesses = partyData.__witnesses || {};
  Object.entries(witnesses).forEach(([key,text])=>{
   if (!text?.trim()) return;
   const [comp, idxStr] = key.split("__");
   const idx = parseInt(idxStr);
   const itemText = getActiveComps()[comp]?.items?.[idx] || "";
   const partyLabel = party==="supervisor"?"المتابع الفني":"المدير المباشر";
   result.push({ party, partyLabel, comp, idx, itemText, witness: text });
  });
  });
  return result;
};

const calcEmployeeScore = (empEval, comps, roleOrUser) => {
  // نختار نموذج التقييم حسب الدور والنوع الفرعي (د-4) — يقبل الدور أو كائن المستخدم
  const model = EVAL_MODELS[getEvalModel(roleOrUser)] || EVAL_MODELS.employee;
  let totalW=0, totalScore=0;
  const partyScores = {};
  Object.entries(model.parties).forEach(([party,def]) => {
  const weight = def.weight||0;
  // المرؤوسون/المستفيدون: يُقيّمون البنود المعلّمة فقط (متوسط ÷ الدرجة الكاملة)
  if (party==="subordinate" || party==="beneficiary") {
    const res = calcRoleItemScore(empEval?.[party], party);
    if (res!==null) {
      partyScores[party] = {avg:res, weight, isRoleItem:true};
      totalScore += res*weight; totalW += weight;
    }
    return;
  }
  const cats = def.cats||[];
  const pc = comps.filter(c=>cats.includes(getCat(c)));
  if (!pc.length) return;
  const scores = pc.map(c=>calcCompScore(c,empEval?.[party]?.[c])).filter(s=>s!==null);
  if (!scores.length) return;
  const avg = scores.reduce((a,b)=>a+b,0)/scores.length;
  partyScores[party] = {avg, weight, scoredComps:scores.length, totalComps:pc.length};
  totalScore += avg*weight; totalW += weight;
  });
  return totalW>0 ? {score:totalScore/totalW, totalW, partyScores} : null;
};

// حساب درجة المرؤوسين/المستفيدين من البنود المعلّمة
// partyEval: { "جدارة": { رقم البند: متوسط تقييمات كل المُقيّمين } }
// يُرجع متوسطاً من 5 (ليتّسق مع باقي الأطراف)
const calcRoleItemScore = (partyEval, party) => {
  if (!partyEval) return null;
  const scores = [];
  Object.keys(partyEval).forEach(comp => {
    const marked = itemsFor(comp, party);
    marked.forEach(idx => {
      const v = Number(partyEval[comp]?.[idx]);
      if (v>0) scores.push(v);
    });
  });
  if (!scores.length) return null;
  return scores.reduce((a,b)=>a+b,0)/scores.length; // متوسط من 5
};

const calcWeightedComp = (compKey, empEval, roleOrUser) => {
  const cat = getCat(compKey);
  const model = EVAL_MODELS[getEvalModel(roleOrUser)] || EVAL_MODELS.employee;
  let totalW=0, totalScore=0;
  // نمرّ على أطراف النموذج، ونستخدم وزن الطرف لهذه الفئة تحديداً (catWeights)
  Object.entries(model.parties).forEach(([party,def]) => {
  const w = def.catWeights ? (def.catWeights[cat]||0) : ((def.cats||[]).includes(cat) ? def.weight : 0);
  if (w<=0) return;
  const s = calcCompScore(compKey, empEval?.[party]?.[compKey]);
  if (s!==null) { totalScore += s*w; totalW += w; }
  });
  return totalW>0 ? {score:totalScore/totalW, totalW} : null;
};

const BRANCHES_LIST = [
  "-- اختر الفرع --",
  "أندلس الزهراء بنين","أندلس الزهراء بنات",
  "أندلس الروضة بنين","أندلس الروضة بنات",
  "أندلس الحمدانية عربي بنين","أندلس الحمدانية عربي بنات",
  "أندلس الحمدانية مصري بنين","أندلس الحمدانية مصري بنات",
  "أندلس مكة المكرمة بنين","أندلس مكة المكرمة بنات",
  "أندلس الطائف بنين","أندلس الطائف بنات",
  "أندلس آبها بنين","أندلس آبها بنات",
  "أندلس خميس مشيط بنين","أندلس خميس مشيط بنات",
  "أندلس الجوف بنين","أندلس الجوف بنات",
  "أندلس نجران بنين","أندلس نجران بنات",
  "أندلس الشاطئ الأهلية بنين","أندلس الشاطئ الأهلية بنات",
  "أندلس الشاطئ العالمية بنين","أندلس الشاطئ العالمية بنات",
  "أندلس الفيحاء بنين","أندلس الفيحاء بنات",
  "أندلس المنار بنين","أندلس المنار بنات",
  "أندلس أبحر بنين","أندلس أبحر بنات",
  "أندلس الرياض بنين","أندلس الرياض بنات",
  "بدون",
];

// الإدارات الوظيفية (تُضاف لنفس قائمة الفرع/الإدارة)
const DEPARTMENTS_LIST = [
  "إدارة التميز التعليمي","إدارة الموارد البشرية","الإدارة المالية",
  "إدارة التواصل المؤسسي","إدارة التقنية","إدارة التميز المؤسسي",
  "إدارة المرافق","إدارة المشتريات","الإدارة التنفيذية",
];
// القائمة الكاملة للفرع/الإدارة (فروع + إدارات)
const BRANCH_DEPT_LIST = [...BRANCHES_LIST.filter(b=>b!=="بدون"), ...DEPARTMENTS_LIST, "بدون"];
// هل القيمة إدارة وظيفية؟ (عندها لا متابع/مرحلة/زميل)
const isDepartment = v => DEPARTMENTS_LIST.includes(v);

const ADMIN_CREDS = { username:"admin", role:"admin", name:"مدير النظام", id:"__admin__" };
const ADMIN_PASS_HASH_DEFAULT = "a36aef5a11c4073fbe60314fc9df530a9d5f986533594d1f5190742ff9e0e408";

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function getAdminPassHash() {
  try { const r = await window.storage.get("adminpass_360c"); if(r?.value) return JSON.parse(r.value); } catch {}
  return ADMIN_PASS_HASH_DEFAULT;
}
const CAT_COLORS = { أساسية:"#3B82F6", عامة:"#10B981", فنية:"#F59E0B" };
// التسمية المعروضة للمستخدم (القيمة المخزّنة تبقى "عامة" لعدم كسر البيانات)
const CAT_LABEL = { أساسية:"أساسية", عامة:"عامة/إدارية/قيادية", فنية:"فنية" };
const catName = c => CAT_LABEL[c] || c;
const SCORE_LABELS = ["","ضعيف","مقبول","جيد","جيد جداً","ممتاز"];
const SCORE_COLORS = ["","#EF4444","#F97316","#F59E0B","#3B82F6","#10B981"];

const getLevel = s => {
  if (s >= 5)   return { label:"ممتاز",   color:"#10B981" };
  if (s >= 4)   return { label:"جيد جداً", color:"#3B82F6" };
  if (s >= 3)   return { label:"جيد",      color:"#F59E0B" };
  if (s >= 2)   return { label:"مقبول",    color:"#F97316" };
  return           { label:"ضعيف",     color:"#EF4444" };
};

const IDP_NEED_SOURCES = ["نتائج تقييم الأداء الوظيفي","نتائج الزيارات الصفية","ملاحظات المدير المباشر","نتائج الزيارات الميدانية","نتائج استطلاعات الرأي من المعنيين","ملاحظات زملاء التخصص","أخرى"];
// ═══ الشهادات الاحترافية (د-9) ═══
// يديرها مدير النظام في «مكتبة المصادر». كل شهادة: {category, name, url, cost}. "أخرى" تتيح نصاً حراً.
const CERT_CATEGORIES = ["إدارية","مالية","موارد بشرية","تقنية","جودة وتميز","تربوية","أخرى"];
const DEFAULT_PROF_CERTS = [
  { category:"إدارية",       name:"PMP - إدارة المشروعات الاحترافية", url:"", cost:"" },
  { category:"مالية",        name:"CMA - محاسب إداري معتمد",         url:"", cost:"" },
  { category:"مالية",        name:"CPA - محاسب قانوني معتمد",        url:"", cost:"" },
  { category:"جودة وتميز",    name:"CIA - مدقق داخلي معتمد",          url:"", cost:"" },
  { category:"موارد بشرية",   name:"SHRM-CP - إدارة الموارد البشرية",  url:"", cost:"" },
  { category:"موارد بشرية",   name:"PHRi - محترف موارد بشرية دولي",   url:"", cost:"" },
  { category:"تقنية",        name:"ITIL - إدارة خدمات تقنية المعلومات", url:"", cost:"" },
  { category:"تقنية",        name:"CISA - مدقق نظم معلومات معتمد",    url:"", cost:"" },
  { category:"جودة وتميز",    name:"Six Sigma - الحزام الأخضر/الأسود", url:"", cost:"" },
  { category:"تربوية",       name:"TOT - تدريب المدربين",            url:"", cost:"" },
];
let _profCerts = DEFAULT_PROF_CERTS;
const getProfCerts = () => _profCerts;
const setProfCerts = (d) => { _profCerts = (d&&d.length)?d : DEFAULT_PROF_CERTS; };
// توافق خلفي: قد تكون عناصر قديمة نصوصاً — نطبّعها لكائنات
const normCert = (c) => typeof c==="string" ? { category:"أخرى", name:c, url:"", cost:"" } : c;
// الأدوار المستهدفة ببند الشهادة الاحترافية (القياديون والتخصصيون)
// كل الأدوار عدا المعلم/الإداري (employee) والمتابع الفني (supervisor).
// المتابع الفني دورٌ لا مسمّى؛ فالوكيل المكلَّف بالمتابعة يبقى مؤهلاً بمسمّاه (deputy).
const CERT_ELIGIBLE_ROLES = ["exec","branch_mgr","stage_mgr","deputy","dept_mgr","specialist","branch_ext"];
const isCertEligible = (u) => u && CERT_ELIGIBLE_ROLES.includes(u.role);
const CERT_STATUS = { none:"لم يبدأ", inprogress:"جارٍ", earned:"حصل عليها" };
const CERT_STATUS_COLOR = { none:"#94A3B8", inprogress:"#F59E0B", earned:"#10B981" };
const IDP_TRAIN_METHODS = ["دورة حضورية داخلية (من إدارة التدريب)","التدريب الحضوري أو الإفتراضي","اللقاءات المهنية والندوات","مشاهدة الوسائط المعلوماتية","القراءة في مجال التخصص","إنشاء محتوى في مجال التخصص","التحدث في اللقاءات أو المؤتمرات","مشاركة المعرفة بالتدريب أو التوجيه"];
const IDP_EVAL_METHODS = ["المجموعات التخصصية Focus group","الملاحظة المباشرة من المتابع الفني Observation","التغذية الراجعة من الزملاء أو المدير المباشر Feedback","استطلاعات العملاء أو التعليقات أو الشكاوى Poll","إنجاز مرتبط بموضوع التعلم Achievement","التقييم القبلي والبعدي Pre/Post"];

const _IMP3 = ["مدى إلمام المتدرب بالمحتوى التدريبي","مدى قدرة المتدرب على تطبيق المحتوى التدريبي في بيئة عمله","إتقان المتدرب للمهارات التي تتضمنها هذه الدورة أو هذا المحتوى"];
const IMPACT_METHODS = {
  "المجموعات التخصصية Focus group": {
  witnessLabel: "إرفاق محضر اجتماع المجموعة",
  items: _IMP3,
  },
  "الملاحظة المباشرة من المتابع الفني Observation": {
  witnessLabel: "إرفاق بطاقة الملاحظة",
  items: _IMP3,
  },
  "التغذية الراجعة من الزملاء أو المدير المباشر Feedback": {
  witnessLabel: "إرفاق نتائج التغذية الراجعة",
  items: ["مدى إلمام المتدرب بالمحتوى التدريبي","متوسط البنود المباشرة فقط في التغذية الراجعة من زملاء التخصص والمدير المباشر"],
  },
  "استطلاعات العملاء أو التعليقات أو الشكاوى Poll": {
  witnessLabel: "إرفاق نتائج الاستطلاع",
  items: ["مدى ارتباط الاستطلاع أو التعليقات أو الشكاوى بالمحتوى التدريبي","متوسط البنود في الاستطلاع أو التعليقات أو الشكاوى التي تخص المتدرب والمحتوى التدريبي"],
  },
  "إنجاز مرتبط بموضوع التعلم Achievement": {
  witnessLabel: "إرفاق صورة أو رابط للإنجاز",
  items: ["مدى ارتباط الإنجاز بالمحتوى التدريبي","تقييم جودة الإنجاز"],
  },
  "التقييم القبلي والبعدي Pre/Post": {
  noWitness: true,
  avgItems: [2,3],
  items: ["مدى إلمام المتدرب بالمحتوى التدريبي قبل التدريب","إتقان المتدرب للمهارات التي تتضمنها هذه الدورة أو هذا المحتوى قبل التدريب","مدى إلمام المتدرب بالمحتوى التدريبي بعد التدريب","إتقان المتدرب للمهارات التي تتضمنها هذه الدورة أو هذا المحتوى بعد التدريب"],
  },
};

const EVAL_PARTIES = [
  { key:"self",       label:"التقييم الذاتي",  color:"#10B981", icon:"👤", cats:["أساسية","عامة","فنية"] },
  { key:"peer",       label:"زملاء التخصص",   color:"#8B5CF6", icon:"🤝", cats:["أساسية"] },
  { key:"supervisor", label:"المتابع الفني",   color:"#3B82F6", icon:"🔍", cats:["عامة","فنية"] },
  { key:"stage_mgr",  label:"المدير المباشر",  color:"#F97316", icon:"📚", cats:["أساسية"] },
  { key:"subordinate",label:"المرؤوسون",       color:"#8B5CF6", icon:"⬆️", cats:[] },
  { key:"beneficiary",label:"المستفيدون",      color:"#0891B2", icon:"🎯", cats:[] },
];

const ROLES_LIST = { admin:"مدير النظام", exec:"إدارة تنفيذية", branch_mgr:"مدير عام فرع", stage_mgr:"مدير مباشر (مرحلة/مجمع)", deputy:"وكيل", supervisor:"متابع فني", dept_mgr:"مدير إدارة وظيفية", specialist:"أخصائي إدارة وظيفية", branch_ext:"امتداد فني لإدارة وظيفية", employee:"معلم/إداري" };
// الأنواع الفرعية لكل دور (فارغ = لا نوع فرعي)
const ROLE_SUBTYPES = {
  exec: { ceo:"رئيس تنفيذي", edu_head:"مدير الشؤون التعليمية", admin_head:"مدير الشؤون الإدارية والمالية", excellence_head:"مدير التخطيط والتميز المؤسسي" },
  deputy: { edu:"وكيل تعليمي", students:"وكيل شؤون طلاب", general:"وكيل" },
  supervisor: { specialist:"مشرف مختص", deputy_role:"وكيل (كمتابع)" },
  dept_mgr: { edu_excellence:"التميز التعليمي", hr:"الموارد البشرية", finance:"المالية", comm:"التواصل المؤسسي", it:"التقنية", facilities:"المرافق", procurement:"المشتريات", org_excellence:"التميز المؤسسي" },
  specialist: { edu_excellence:"التميز التعليمي", hr:"الموارد البشرية", finance:"المالية", comm:"التواصل المؤسسي", it:"التقنية", facilities:"المرافق", procurement:"المشتريات", org_excellence:"التميز المؤسسي" },
  branch_ext: { edu_excellence:"التميز التعليمي", hr:"الموارد البشرية", finance:"المالية", comm:"التواصل المؤسسي", it:"التقنية", facilities:"المرافق", procurement:"المشتريات", org_excellence:"التميز المؤسسي" },
  employee: { teacher:"معلم", admin_staff:"إداري" },
};
const STAGES = ["رياض اطفال","ابتدائي","متوسط","ثانوي","مسار القرآن /دبلوما/ تربية خاصة","إدارة الفرع"];

const st = {
  get: async k => { try { const r = await window.storage.get(k); return r ? JSON.parse(r.value) : null; } catch { return null; } },
  set: async (k,v) => { try { await window.storage.set(k, JSON.stringify(v)); } catch {} },
  getShared: async k => { try { const r = await window.storage.get(k, true); return r ? JSON.parse(r.value) : null; } catch { return null; } },
  setShared: async (k,v) => { try { await window.storage.set(k, JSON.stringify(v), true); } catch {} },
  // ج-3: نسيت كلمة السر (محلياً بلا فعل حقيقي؛ يُربط بالـAPI على الخادم عبر transform)
  forgotPassword: async (_username) => { return { ok:true }; },
};

// ب-4: التقييم الثاني — الجولة الثانية تُخزَّن في empEval.__r2 (نسخة كاملة مستقلّة)
// درجة موظف من كائن تقييم معيّن (جولة واحدة)
function scoreOfRound(roundEval, u) {
  if (!roundEval) return null;
  const comps = getActiveJobs()[u.job]||[];
  const s = calcEmployeeScore(roundEval, comps, u);
  return s?.score ?? null;
}
// هل للموظف جولة ثانية فيها بيانات؟
function hasRound2(empEval) {
  const r2 = empEval?.__r2;
  return !!r2 && Object.keys(r2).some(k=>k!=="__meta" && r2[k] && Object.keys(r2[k]).length>0);
}
// الدرجة النهائية = متوسط الجولتين إن وُجدت الثانية، وإلا الأولى وحدها
function finalTwoRoundScore(empEval, u) {
  const s1 = scoreOfRound(empEval, u);
  if (!hasRound2(empEval)) return s1;
  const s2 = scoreOfRound(empEval.__r2, u);
  if (s1==null) return s2;
  if (s2==null) return s1;
  return Math.round(((s1+s2)/2)*100)/100;
}

// مفتاح اعتماد نتائج التقييم لفرع+مرحلة (عام — يُستخدم في عدة لوحات)
const stageEvalKeyG = (br,stage)=>`${br}__${stage}__eval`;

// ب-4: سياق الجولة النشطة للكتابة (تُضبط من اللوحات حسب round2.open + ترشيح الموظف)
let _round2Open = false;                 // هل التقييم الثاني مفتوح عالمياً؟
let _round2Nominees = [];                // قائمة المرشّحين
const setRound2Ctx = (open, nominees) => { _round2Open = !!open; _round2Nominees = nominees||[]; };
// هل نكتب في الجولة الثانية لهذا الموظف؟ (مفتوح + مرشّح)
const isR2Active = (targetId) => _round2Open && _round2Nominees.includes(targetId);
// كتابة درجة طرف في الجولة الصحيحة
const writePartyScore = (empObj, party, scores, targetId) => {
  if (isR2Active(targetId)) { empObj.__r2 = {...(empObj.__r2||{})}; empObj.__r2[party] = scores; }
  else { empObj[party] = scores; }
  return empObj;
};
// قراءة درجة طرف من الجولة الصحيحة (للنماذج: تعرض بيانات الجولة النشطة)
const readPartyScore = (empObj, party, targetId) => {
  if (isR2Active(targetId)) return (empObj?.__r2||{})[party]||{};
  return empObj?.[party]||{};
};

// ج-4: توليد شهادة حضور (HTML مطابق للقالب، يُفتح للطباعة/حفظ PDF) — 5 بيانات متغيّرة
function generateAttendanceCertificate({ name, courseName, date, hours, trainer }) {
  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>شهادة حضور - ${name}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=El+Messiri:wght@400;600;700&display=swap');
    @page { size: A4 landscape; margin: 0; }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'El Messiri',sans-serif; }
    .cert { width:1123px; height:794px; margin:0 auto; position:relative; background:#fff;
      border:14px solid #15385C; outline:3px solid #C9A24B; outline-offset:6px; padding:60px 80px; text-align:center; }
    .cert::before { content:""; position:absolute; inset:18px; border:2px solid #C9A24B; pointer-events:none; }
    .logo { font-size:26px; font-weight:700; color:#15385C; margin-bottom:8px; letter-spacing:-0.5px; }
    .title { font-size:44px; font-weight:700; color:#15385C; margin:24px 0 8px; }
    .rule { width:200px; height:3px; background:#C9A24B; margin:8px auto 32px; }
    .line { font-size:19px; color:#334155; margin:10px 0; line-height:1.9; }
    .name { font-size:32px; font-weight:700; color:#15385C; margin:14px 0; }
    .course { font-size:28px; font-weight:700; color:#0891B2; margin:14px 0; }
    .meta { font-size:20px; color:#334155; margin:18px 0; }
    .meta b { color:#15385C; }
    .footer { position:absolute; bottom:70px; left:80px; right:80px; display:flex; justify-content:space-around; }
    .sig { font-size:15px; color:#5B7A9E; }
    .sig .role { font-weight:700; color:#15385C; margin-bottom:28px; display:block; }
    @media print { body{-webkit-print-color-adjust:exact; print-color-adjust:exact;} .noprint{display:none;} }
    .noprint { position:fixed; top:16px; left:16px; background:#15385C; color:#fff; border:none; padding:12px 24px; border-radius:8px; font-size:15px; cursor:pointer; font-family:inherit; }
  </style></head><body>
  <button class="noprint" onclick="window.print()">🖨️ طباعة / حفظ PDF</button>
  <div class="cert">
    <div class="logo">شركة الأندلس التعليمية</div>
    <div class="title">شهادة حضور</div>
    <div class="rule"></div>
    <div class="line">تشهد شركة الأندلس التعليمية بأن:</div>
    <div class="name">الأستاذ / ة ${name}</div>
    <div class="line">قد حضر / ت البرنامج التدريبي:</div>
    <div class="course">${courseName}</div>
    <div class="meta">بتاريخ <b>${date||"—"}</b> وبمعدل <b>${hours||"—"}</b> ساعات تدريبية</div>
    <div class="line">وذلك ضمن برامج التدريب الداخلي بشركة الأندلس التعليمية</div>
    <div class="line">وبناءً على ذلك مُنحت له / ها هذه الشهادة</div>
    <div class="footer">
      <div class="sig"><span class="role">المدرب</span>${trainer||"—"}</div>
      <div class="sig"><span class="role">أخصائي التدريب</span>أ. حازم البدري</div>
      <div class="sig"><span class="role">مدير الموارد البشرية</span>أ. أحمد الغامدي</div>
    </div>
  </div>
  <script>setTimeout(()=>window.print(),600);</script>
  </body></html>`;
  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); }
}

const CERT_MIN_ATTENDANCE = 75; // نسبة الحضور الدنيا لإصدار الشهادة

function getEmpFullStats(u, evals) {
  const empEval = evals[u.id]||{};
  const comps = getActiveJobs()[u.job]||[];
  const partyCompletion = {};
  EVAL_PARTIES.forEach(p=>{
  const ac=PARTY_CATS[p.key]||[];
  const mc=comps.filter(c=>ac.includes(getCat(c)));
  const ti=mc.reduce((s,c)=>(getActiveComps()[c]?.items?.length||0)+s,0);
  const si=mc.reduce((s,c)=>{const it=getActiveComps()[c]?.items||[];return s+it.filter((_,i)=>(empEval?.[p.key]?.[c]?.[i]||0)>0).length;},0);
  partyCompletion[p.key]=ti>0?Math.round((si/ti)*100):0;
  });
  const empScore=calcEmployeeScore(empEval,comps,u);
  const avg=empScore?.score??null;
  // ب-4: متوسط الجولتين إن وُجدت الثانية
  const round2Exists = hasRound2(empEval);
  const r1Score = avg;
  const r2Score = round2Exists ? scoreOfRound(empEval.__r2, u) : null;
  const finalAvg = round2Exists ? finalTwoRoundScore(empEval, u) : avg;
  const sc=comps.map(c=>({c,ws:calcWeightedComp(c,empEval,u)})).filter(x=>x.ws!==null).sort((a,b)=>b.ws.score-a.ws.score);
  return {partyCompletion,avg:finalAvg,round1Avg:r1Score,round2Avg:r2Score,hasRound2:round2Exists,partyScores:empScore?.partyScores||{},topComp:sc[0]||null,botComp:sc[sc.length-1]||null};
}

function groupStats(empList, evals) {
  if(!empList.length) return null;
  const allStats=empList.map(u=>getEmpFullStats(u,evals));
  const avgs=allStats.map(s=>s.avg).filter(x=>x!==null);
  const groupAvg=avgs.length>0?avgs.reduce((a,b)=>a+b,0)/avgs.length:null;
  const partyCompletion={};
  EVAL_PARTIES.forEach(p=>{const vs=allStats.map(s=>s.partyCompletion[p.key]);partyCompletion[p.key]=vs.length>0?Math.round(vs.reduce((a,b)=>a+b,0)/vs.length):0;});
  const stdDev=avgs.length>1?Math.sqrt(avgs.reduce((s,v)=>s+Math.pow(v-(groupAvg||0),2),0)/avgs.length):null;
  const partyAvgScores={};
  EVAL_PARTIES.forEach(p=>{const sc=allStats.map(s=>s.partyScores?.[p.key]?.avg).filter(x=>x!=null);partyAvgScores[p.key]=sc.length>0?sc.reduce((a,b)=>a+b,0)/sc.length:null;});
  const levelDist={"ممتاز":0,"جيد جداً":0,"جيد":0,"مقبول":0,"ضعيف":0};
  avgs.forEach(a=>{levelDist[getLevel(a).label]=(levelDist[getLevel(a).label]||0)+1;});
  const ranked=allStats.map((s,i)=>({...s,user:empList[i]})).filter(s=>s.avg!==null).sort((a,b)=>b.avg-a.avg);
  const compMap={};
  empList.forEach(u=>{const ee=evals[u.id]||{};(getActiveJobs()[u.job]||[]).forEach(c=>{const w=calcWeightedComp(c,ee,u);if(w!==null){if(!compMap[c])compMap[c]=[];compMap[c].push(w.score);}});});
  const compAvgs=Object.entries(compMap).map(([c,s])=>({c,avg:s.reduce((a,b)=>a+b,0)/s.length,std:s.length>1?Math.sqrt(s.reduce((sv,v)=>sv+Math.pow(v-s.reduce((a,b)=>a+b,0)/s.length,2),0)/s.length):0})).sort((a,b)=>b.avg-a.avg);
  return{groupAvg,stdDev,partyCompletion,partyAvgScores,levelDist,ranked,compAvgs,total:empList.length,withData:avgs.length,allAvgs:avgs};
}

function EvalStatusBoard({ emps, evals, locks, onOpenCard }) {
  const partyState = (u, pk) => {
  if (locks && locks[`${u.id}__${pk}`]) return "done";
  const pe = (evals[u.id]||{})[pk]||{};
  let has = false;
  Object.keys(pe).forEach(c=>{ if(c==="__witnesses")return; const it=pe[c]; if(it&&typeof it==="object"&&Object.values(it).some(v=>v>0)) has=true; });
  return has ? "progress" : "none";
  };
  const stMeta = { done:{l:"تم",c:"#10B981",bg:"#10B98115",i:"✅"}, progress:{l:"جاري",c:"#F59E0B",bg:"#F59E0B15",i:"🟡"}, none:{l:"لم يبدأ",c:"#94A3B8",bg:"#F1F5F9",i:"⚪"} };

  if (!emps.length) return <div style={{textAlign:"center",padding:24,color:"#8CA3BD",fontSize:12}}>لا موظفون في هذه المرحلة</div>;

  return (
  <div style={{overflowX:"auto"}}>
   <table style={{width:"100%",borderCollapse:"separate",borderSpacing:0,fontSize:11,minWidth:560}}>
  <thead>
  <tr>
   <th style={{position:"sticky",right:0,background:"#EFF6FE",padding:"9px 12px",textAlign:"right",color:"#15385C",fontWeight:800,borderBottom:"2px solid #C7DBF0",borderTopRightRadius:10}}>الموظف</th>
   {EVAL_PARTIES.map(p=>(
   <th key={p.key} style={{padding:"9px 8px",color:p.color,fontWeight:800,borderBottom:"2px solid #C7DBF0",whiteSpace:"nowrap",textAlign:"center"}}>{p.icon} {p.label}</th>
   ))}
   <th style={{padding:"9px 10px",color:"#5B7A9E",fontWeight:800,borderBottom:"2px solid #C7DBF0",textAlign:"center",borderTopLeftRadius:10}}>الإنجاز</th>
  </tr>
  </thead>
  <tbody>
  {emps.map((u,ri)=>{
   const states = EVAL_PARTIES.map(p=>partyState(u,p.key));
   const doneCount = states.filter(s=>s==="done").length;
   const pct = doneCount*25;
   const remain = 100-pct;
   return (
   <tr key={u.id} style={{background:ri%2===0?"#FFFFFF":"#F7FAFE"}}>
  <td style={{position:"sticky",right:0,background:ri%2===0?"#FFFFFF":"#F7FAFE",padding:"9px 12px",fontWeight:700,color:"#15385C",borderBottom:"1px solid #EDF4FC",whiteSpace:"nowrap"}}>
  {onOpenCard
   ? <button onClick={()=>onOpenCard(u)} style={{background:"none",border:"none",padding:0,color:"#2E7FB8",fontWeight:700,fontSize:11,cursor:"pointer",textDecoration:"underline",textAlign:"right"}}>{u.name} 👁️</button>
   : u.name}
  <div style={{fontSize:9,color:"#8CA3BD",fontWeight:400}}>{u.job}</div>
  </td>
  {states.map((s,ci)=>{
  const m=stMeta[s];
  return (
  <td key={ci} style={{padding:"7px 6px",textAlign:"center",borderBottom:"1px solid #EDF4FC"}}>
  <span style={{display:"inline-flex",alignItems:"center",gap:4,background:m.bg,color:m.c,padding:"3px 10px",borderRadius:20,fontWeight:700,fontSize:10,whiteSpace:"nowrap"}}>{m.i} {m.l}</span>
  </td>
  );
  })}
  <td style={{padding:"7px 10px",textAlign:"center",borderBottom:"1px solid #EDF4FC"}}>
  <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
  <span style={{fontSize:12,fontWeight:900,color:pct===100?"#10B981":pct>=50?"#F59E0B":"#EF4444",fontFamily:MONO}}>{pct}%</span>
  <div style={{width:60,height:6,background:"#EDF4FC",borderRadius:20,overflow:"hidden"}}>
  <div style={{width:`${pct}%`,height:"100%",background:pct===100?"#10B981":pct>=50?"#F59E0B":"#EF4444",borderRadius:20}}/>
  </div>
  <span style={{fontSize:8,color:"#B6C7DA"}}>المتبقّي {remain}%</span>
  </div>
  </td>
   </tr>
   );
  })}
  </tbody>
   </table>
  </div>
  );
}

function AggregateReport({ users, evals, currentUser, restrictBranch }) {
  const [scope,setScope]=useState("all");
  const [selBranch,setSelBranch]=useState("");
  const [selStage,setSelStage]=useState("");
  const [selSupervisor,setSelSupervisor]=useState("");
  const allUsers=users||[];
  const hasRoles=allUsers.some(u=>u.role);
  const employees=hasRoles?allUsers.filter(u=>u.role==="employee"):allUsers;
  const supervisors=hasRoles?allUsers.filter(u=>u.role==="supervisor"):[];
  const branches=[...new Set(employees.map(u=>u.branch).filter(Boolean))].sort();
  const stages=[...new Set(employees.map(u=>u.stage).filter(Boolean))].sort();
  const filteredEmps=useMemo(()=>{
  let list=employees;
  if(scope==="branch"&&selBranch)list=list.filter(u=>u.branch===selBranch);
  if(scope==="stage"&&selStage)list=list.filter(u=>u.stage===selStage);
  if(scope==="supervisor"&&selSupervisor)list=list.filter(u=>u.supervisorId===selSupervisor);
  return list;
  },[scope,selBranch,selStage,selSupervisor,employees]);
  const stats=useMemo(()=>groupStats(filteredEmps,evals),[filteredEmps,evals]);
  const branchStats=useMemo(()=>{
  const bs=[...new Set(filteredEmps.map(u=>u.branch).filter(Boolean))];
  return bs.map(branch=>{
   const be=filteredEmps.filter(u=>u.branch===branch);
   const gs=groupStats(be,evals);
   return{branch,avg:gs?.groupAvg??null,stdDev:gs?.stdDev??null};
  }).filter(b=>b.avg!==null).sort((a,b)=>b.avg-a.avg);
  },[filteredEmps,evals]);
  const fmt=v=>v!=null?v.toFixed(2):"—";
  const scopeLabel=scope==="all"?"جميع الفروع":scope==="branch"?(selBranch||"—"):scope==="stage"?(selStage||"—"):supervisors.find(s=>s.id===selSupervisor)?.name||"—";
  const S={dir:"rtl",fontFamily:"'El Messiri',sans-serif"};
  return(
  <div style={S}>
   <div style={{background:"#FFFFFF",border:"1px solid #B3D0EA",borderRadius:14,padding:18,marginBottom:14}}>
  <div style={{fontSize:13,color:"#2E7FB8",fontWeight:800,marginBottom:restrictBranch?0:12}}>📑 {restrictBranch?"تحليل تقييمات موظفيك":"التقرير المجمع"}</div>
  {!restrictBranch&&<>
  <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
  {[{k:"all",l:"🏢 جميع"},{k:"branch",l:"🏫 فرع"},{k:"stage",l:"📚 مرحلة"},{k:"supervisor",l:"🔍 متابع فني"}].map(s=>(
   <button key={s.k} onClick={()=>setScope(s.k)} style={{padding:"5px 12px",borderRadius:20,border:`1px solid ${scope===s.k?"#3B82F6":"#C7DBF0"}`,background:scope===s.k?"#3B82F620":"transparent",color:scope===s.k?"#3B82F6":"#5B7A9E",fontSize:11,cursor:"pointer"}}>{s.l}</button>
  ))}
  </div>
  {scope==="branch"&&<select value={selBranch} onChange={e=>setSelBranch(e.target.value)} style={{padding:"6px 10px",background:"#F4F9FE",border:"1px solid #C7DBF0",borderRadius:8,color:"#1E293B",fontSize:12}}><option value="">— اختر —</option>{branches.map(b=><option key={b} value={b}>{b}</option>)}</select>}
  {scope==="stage"&&<select value={selStage} onChange={e=>setSelStage(e.target.value)} style={{padding:"6px 10px",background:"#F4F9FE",border:"1px solid #C7DBF0",borderRadius:8,color:"#1E293B",fontSize:12}}><option value="">— اختر —</option>{stages.map(s=><option key={s} value={s}>{s}</option>)}</select>}
  {scope==="supervisor"&&<select value={selSupervisor} onChange={e=>setSelSupervisor(e.target.value)} style={{padding:"6px 10px",background:"#F4F9FE",border:"1px solid #C7DBF0",borderRadius:8,color:"#1E293B",fontSize:12}}><option value="">— اختر —</option>{supervisors.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>}
  </>}
  {restrictBranch&&<div style={{fontSize:11,color:"#5B7A9E",marginTop:6}}>يعرض هذا التحليل موظفيك ومتوسط أدائهم لكل جدارة</div>}
   </div>
   {!stats?<div style={{textAlign:"center",padding:40,color:"#5B7A9E"}}>لا يوجد بيانات في هذا النطاق</div>:(
  <div>
  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
   {[{l:"الموظفون",v:stats.total,c:"#3B82F6"},{l:"لديهم بيانات",v:stats.withData,c:"#10B981"},{l:"المتوسط العام",v:fmt(stats.groupAvg),c:"#F59E0B"}].map((card,i)=>(
   <div key={i} style={{background:"#FFFFFF",border:`1px solid ${card.c}20`,borderRadius:10,padding:"12px",textAlign:"center"}}>
  <div style={{fontSize:20,fontWeight:900,color:card.c,fontFamily:MONO}}>{card.v}</div>
  <div style={{fontSize:10,color:"#5B7A9E",marginTop:3}}>{card.l}</div>
   </div>
   ))}
  </div>
  <div style={{background:BRAND.cardBg,border:`1px solid ${BRAND.cardBorder}`,borderRadius:12,padding:16,marginBottom:14}}>
   <div style={{fontSize:12,color:"#2E7FB8",fontWeight:700,marginBottom:10}}>نسب الإنجاز</div>
   {EVAL_PARTIES.map(p=>{const v=stats.partyCompletion[p.key];return(
   <div key={p.key} style={{marginBottom:8}}>
  <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:p.color,marginBottom:3}}><span>{p.icon} {p.label}</span><span style={{fontFamily:MONO}}>{v}%</span></div>
  <div style={{height:4,background:"#DDE9F5",borderRadius:2,overflow:"hidden"}}><div style={{width:`${v}%`,height:"100%",background:v>=80?"#10B981":v>=50?"#F59E0B":"#EF4444",borderRadius:2}}/></div>
   </div>
   );})}
  </div>
  {stats.compAvgs.length>0&&(
   <div style={{background:BRAND.cardBg,border:`1px solid ${BRAND.cardBorder}`,borderRadius:12,padding:16,marginBottom:14}}>
   <div style={{fontSize:12,color:"#2E7FB8",fontWeight:700,marginBottom:10}}>ترتيب الجدارات</div>
   <div style={{maxHeight:260,overflowY:"auto"}}>
  {stats.compAvgs.map((x,i)=>{const lv=getLevel(x.avg);return(
  <div key={x.c} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 8px",background:i%2===0?"#F4F9FE":"transparent",borderRadius:5,marginBottom:2}}>
  <span style={{width:20,fontSize:10,color:"#5B7A9E",textAlign:"center"}}>{i+1}</span>
  <span style={{flex:1,fontSize:11,color:"#94A3B8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{x.c}</span>
  <div style={{width:60,height:4,background:"#DDE9F5",borderRadius:2,overflow:"hidden"}}><div style={{width:`${(x.avg/5)*100}%`,height:"100%",background:lv.color}}/></div>
  <span style={{width:32,fontSize:11,fontWeight:700,color:lv.color,fontFamily:MONO}}>{x.avg.toFixed(2)}</span>
  </div>
  );})}
   </div>
   </div>
  )}
  <div style={{background:BRAND.cardBg,border:`1px solid ${BRAND.cardBorder}`,borderRadius:12,padding:16}}>
   <div style={{fontSize:12,color:"#2E7FB8",fontWeight:700,marginBottom:10}}>ترتيب الموظفين</div>
   {stats.ranked.slice(0,20).map((s,i)=>{const lv=getLevel(s.avg);const medal=i===0?"🥇":i===1?"🥈":i===2?"🥉":null;return(
   <div key={s.user.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",background:"#F4F9FE",borderRadius:7,marginBottom:4}}>
  <span style={{width:20,textAlign:"center"}}>{medal||<span style={{fontSize:10,color:"#5B7A9E"}}>{i+1}</span>}</span>
  <div style={{flex:1}}><div style={{fontSize:11,color:"#1E293B",fontWeight:700}}>{s.user.name}</div><div style={{fontSize:10,color:"#5B7A9E"}}>{s.user.job}</div></div>
  <span style={{fontSize:12,fontWeight:900,color:lv.color,fontFamily:MONO}}>{((s.avg/5)*100).toFixed(1)}%</span>
  <span style={{fontSize:10,color:lv.color}}>{lv.label}</span>
   </div>
   );})}
  </div>
  </div>
   )}
  </div>
  );
}

function PrintButton({ title, branch }) {
  return (
  <button onClick={()=>window.print()} style={{padding:"5px 13px",borderRadius:20,border:"1px solid #475569",background:"transparent",color:"#94A3B8",fontSize:11,cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
   🖨️ طباعة
  </button>
  );
}

const APP_BG = "radial-gradient(1000px 500px at 85% -5%,#DBEAFE 0%,rgba(219,234,254,0) 55%), radial-gradient(800px 450px at 10% 0%,#E0F2FE 0%,rgba(224,242,254,0) 50%), linear-gradient(180deg,#F1F6FB 0%,#E8EFF7 100%)";

const BRAND = {
  primary: "#2E7FB8",
  primaryLight: "#4FA3D9",
  primaryDark: "#1D5A8A",
  gradPrimary: "linear-gradient(135deg,#1D5A8A 0%,#2E7FB8 60%,#4FA3D9 100%)",
  gradGreen: "linear-gradient(135deg,#059669,#10B981)",
  gradAmber: "linear-gradient(135deg,#D97706,#F59E0B)",
  gradPurple: "linear-gradient(135deg,#6D28D9,#8B5CF6)",
  cardBg: "linear-gradient(160deg,#FFFFFF,#F6FAFE)",
  cardBorder: "#C7DBF0",
  softShadow: "0 6px 22px rgba(46,127,184,0.10)",
  textMain: "#15385C",
  textSub: "#5B7A9E",
  textMuted: "#8CA3BD",
  surface: "#FFFFFF",
  surfaceAlt: "#F4F9FE",
  border: "#C7DBF0",
  borderSoft: "#DDE9F5",
};

function GlobalStyles() {
  return (
  <>
   <link href="https://fonts.googleapis.com/css2?family=El+Messiri:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap" rel="stylesheet"/>
   <style>{`
  * { -webkit-tap-highlight-color: transparent; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
  body, button, select, input, textarea, div, span, h1, h2, h3, p, label, a, td, th, option, summary { font-family: 'El Messiri', sans-serif; }
  button, select, input, textarea, a { transition: all 0.18s cubic-bezier(0.4,0,0.2,1); }
  button:not(:disabled):hover { filter: brightness(1.12); transform: translateY(-1px); }
  button:not(:disabled):active { transform: translateY(0) scale(0.98); }
  select:focus, input:focus, textarea:focus { border-color: #2E7FB8 !important; box-shadow: 0 0 0 3px rgba(46,127,184,0.15); }
  ::-webkit-scrollbar { width: 9px; height: 9px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #B3D0EA; border-radius: 20px; border: 2px solid transparent; background-clip: padding-box; }
  ::-webkit-scrollbar-thumb:hover { background: #8CA3BD; background-clip: padding-box; }
  @keyframes fadeInUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
  .card-hover { transition: all 0.2s cubic-bezier(0.4,0,0.2,1); }
  .card-hover:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.35), 0 0 0 1px rgba(46,127,184,0.15); }
   `}</style>
  </>
  );
}

function ChangePasswordButton({ userId, currentPassword, compact }) {
  const [open,setOpen] = useState(false);
  const [oldP,setOldP] = useState("");
  const [newP,setNewP] = useState("");
  const [confirmP,setConfirmP] = useState("");
  const [show,setShow] = useState(false);
  const [msg,setMsg] = useState(null);

  const submit = async () => {
  setMsg(null);
  if (oldP !== currentPassword) { setMsg({t:"كلمة المرور الحالية غير صحيحة",c:"#EF4444"}); return; }
  if (newP.length < 6) { setMsg({t:"كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف",c:"#EF4444"}); return; }
  if (newP !== confirmP) { setMsg({t:"تأكيد كلمة المرور غير مطابق",c:"#EF4444"}); return; }
  if (newP === currentPassword) { setMsg({t:"كلمة المرور الجديدة مطابقة للحالية",c:"#F59E0B"}); return; }
  try {
   const r = await window.storage.get("users_360c");
   const list = r?.value ? JSON.parse(r.value) : [];
   const updated = list.map(u => u.id===userId ? {...u, password:newP} : u);
   await window.storage.set("users_360c", JSON.stringify(updated));
   setMsg({t:"✓ تم تغيير كلمة المرور بنجاح",c:"#10B981"});
   setOldP(""); setNewP(""); setConfirmP("");
   setTimeout(()=>{ setOpen(false); setMsg(null); }, 1400);
  } catch(e) { setMsg({t:"خطأ في الحفظ، حاول مجدداً",c:"#EF4444"}); }
  };

  const iS={width:"100%",padding:"9px 11px",background:"#F4F9FE",border:"1px solid #C7DBF0",borderRadius:8,color:"#1E293B",fontSize:12,boxSizing:"border-box",outline:"none"};
  const lS={display:"block",fontSize:11,color:"#5B7A9E",marginBottom:5,fontWeight:700};

  return(
  <>
   <button onClick={()=>{setOpen(true);setMsg(null);setOldP("");setNewP("");setConfirmP("");}}
  title="تغيير كلمة المرور"
  style={{padding:compact?"4px 10px":"5px 12px",borderRadius:20,border:"1px solid #3B82F630",background:"#3B82F610",color:"#2E7FB8",fontSize:11,cursor:"pointer"}}>
  🔑 كلمة المرور
   </button>
   {open&&ReactDOM.createPortal(
  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:900,display:"flex",overflowY:"auto",padding:16}} onClick={e=>{if(e.target===e.currentTarget)setOpen(false);}}>
  <div style={{background:"#FFFFFF",border:"1px solid #B3D0EA",borderRadius:20,width:"100%",maxWidth:420,padding:26,direction:"rtl",margin:"auto",maxHeight:"94vh",overflowY:"auto",boxSizing:"border-box"}}>
   <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
   <span style={{fontSize:15,fontWeight:900,color:"#15385C"}}>🔑 تغيير كلمة المرور</span>
   <button onClick={()=>setOpen(false)} style={{background:"none",border:"none",color:"#5B7A9E",fontSize:22,cursor:"pointer"}}>✕</button>
   </div>
   <div style={{display:"flex",flexDirection:"column",gap:12}}>
   <div>
  <label style={lS}>كلمة المرور الحالية</label>
  <input type={show?"text":"password"} value={oldP} onChange={e=>setOldP(e.target.value)} style={iS} autoComplete="off"/>
   </div>
   <div>
  <label style={lS}>كلمة المرور الجديدة</label>
  <input type={show?"text":"password"} value={newP} onChange={e=>setNewP(e.target.value)} placeholder="6 أحرف على الأقل" style={iS} autoComplete="off"/>
   </div>
   <div>
  <label style={lS}>تأكيد كلمة المرور الجديدة</label>
  <input type={show?"text":"password"} value={confirmP} onChange={e=>setConfirmP(e.target.value)} style={iS} autoComplete="off"/>
   </div>
   <label style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:"#5B7A9E",cursor:"pointer"}}>
  <input type="checkbox" checked={show} onChange={e=>setShow(e.target.checked)}/> إظهار كلمات المرور
   </label>
   {msg&&<div style={{fontSize:12,color:msg.c,background:`${msg.c}12`,padding:"8px 12px",borderRadius:8,fontWeight:700,textAlign:"center"}}>{msg.t}</div>}
   <div style={{display:"flex",gap:10,marginTop:4}}>
  <button onClick={()=>setOpen(false)} style={{flex:1,padding:"11px",borderRadius:10,border:"1px solid #C7DBF0",background:"transparent",color:"#5B7A9E",cursor:"pointer"}}>إلغاء</button>
  <button onClick={submit} style={{flex:2,padding:"11px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#1D5A8A,#2E7FB8)",color:"#fff",fontWeight:700,cursor:"pointer"}}>💾 حفظ كلمة المرور</button>
   </div>
   </div>
  </div>
  </div>
   , document.body)}
  </>
  );
}

function AdminChangePasswordButton() {
  const [open,setOpen] = useState(false);
  const [oldP,setOldP] = useState("");
  const [newP,setNewP] = useState("");
  const [confirmP,setConfirmP] = useState("");
  const [show,setShow] = useState(false);
  const [msg,setMsg] = useState(null);

  const submit = async () => {
  setMsg(null);
  const oldHash = await sha256Hex(oldP);
  const currentHash = await getAdminPassHash();
  if (oldHash !== currentHash) { setMsg({t:"كلمة المرور الحالية غير صحيحة",c:"#EF4444"}); return; }
  if (newP.length < 6) { setMsg({t:"كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف",c:"#EF4444"}); return; }
  if (newP !== confirmP) { setMsg({t:"تأكيد كلمة المرور غير مطابق",c:"#EF4444"}); return; }
  if (newP === oldP) { setMsg({t:"كلمة المرور الجديدة مطابقة للحالية",c:"#F59E0B"}); return; }
  try {
   const newHash = await sha256Hex(newP);
   await window.storage.set("adminpass_360c", JSON.stringify(newHash));
   setMsg({t:"✓ تم تغيير كلمة المرور بنجاح",c:"#10B981"});
   setOldP(""); setNewP(""); setConfirmP("");
   setTimeout(()=>{ setOpen(false); setMsg(null); }, 1400);
  } catch(e) { setMsg({t:"خطأ في الحفظ، حاول مجدداً",c:"#EF4444"}); }
  };

  const iS={width:"100%",padding:"9px 11px",background:"#F4F9FE",border:"1px solid #C7DBF0",borderRadius:8,color:"#1E293B",fontSize:12,boxSizing:"border-box",outline:"none"};
  const lS={display:"block",fontSize:11,color:"#5B7A9E",marginBottom:5,fontWeight:700};

  return(
  <>
   <button onClick={()=>{setOpen(true);setMsg(null);setOldP("");setNewP("");setConfirmP("");}}
  title="تغيير كلمة مرور المدير"
  style={{padding:"5px 11px",borderRadius:20,border:"1px solid #3B82F630",background:"#3B82F610",color:"#2E7FB8",fontSize:11,cursor:"pointer"}}>
  🔑 كلمة المرور
   </button>
   {open&&ReactDOM.createPortal(
  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:900,display:"flex",overflowY:"auto",padding:16}} onClick={e=>{if(e.target===e.currentTarget)setOpen(false);}}>
  <div style={{background:"#FFFFFF",border:"1px solid #B3D0EA",borderRadius:20,width:"100%",maxWidth:420,padding:26,direction:"rtl",margin:"auto",maxHeight:"94vh",overflowY:"auto",boxSizing:"border-box"}}>
   <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
   <span style={{fontSize:15,fontWeight:900,color:"#15385C"}}>🔑 تغيير كلمة مرور المدير</span>
   <button onClick={()=>setOpen(false)} style={{background:"none",border:"none",color:"#5B7A9E",fontSize:22,cursor:"pointer"}}>✕</button>
   </div>
   <div style={{display:"flex",flexDirection:"column",gap:12}}>
   <div>
  <label style={lS}>كلمة المرور الحالية</label>
  <input type={show?"text":"password"} value={oldP} onChange={e=>setOldP(e.target.value)} style={iS} autoComplete="off"/>
   </div>
   <div>
  <label style={lS}>كلمة المرور الجديدة</label>
  <input type={show?"text":"password"} value={newP} onChange={e=>setNewP(e.target.value)} placeholder="6 أحرف على الأقل" style={iS} autoComplete="off"/>
   </div>
   <div>
  <label style={lS}>تأكيد كلمة المرور الجديدة</label>
  <input type={show?"text":"password"} value={confirmP} onChange={e=>setConfirmP(e.target.value)} style={iS} autoComplete="off"/>
   </div>
   <label style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:"#5B7A9E",cursor:"pointer"}}>
  <input type="checkbox" checked={show} onChange={e=>setShow(e.target.checked)}/> إظهار كلمات المرور
   </label>
   {msg&&<div style={{fontSize:12,color:msg.c,background:`${msg.c}12`,padding:"8px 12px",borderRadius:8,fontWeight:700,textAlign:"center"}}>{msg.t}</div>}
   <div style={{display:"flex",gap:10,marginTop:4}}>
  <button onClick={()=>setOpen(false)} style={{flex:1,padding:"11px",borderRadius:10,border:"1px solid #C7DBF0",background:"transparent",color:"#5B7A9E",cursor:"pointer"}}>إلغاء</button>
  <button onClick={submit} style={{flex:2,padding:"11px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#1D5A8A,#2E7FB8)",color:"#fff",fontWeight:700,cursor:"pointer"}}>💾 حفظ كلمة المرور</button>
   </div>
   </div>
  </div>
  </div>
   , document.body)}
  </>
  );
}

function LoginScreen({ onLogin }) {
  const [u,setU] = useState(""); const [p,setP] = useState(""); const [err,setErr] = useState(false); const [show,setShow] = useState(false);
  const [maintMsg,setMaintMsg] = useState("");
  const [mode,setMode] = useState("login"); // login | forgot
  const [fEmail,setFEmail] = useState(""); const [fMsg,setFMsg] = useState(null); const [fBusy,setFBusy] = useState(false);
  const submitForgot = async () => {
  if (!fEmail.trim()) return;
  setFBusy(true); setFMsg(null);
  try {
   // على الخادم: يستدعي /auth/forgot-password. محلياً: رسالة إرشادية موحّدة.
   if (typeof st.forgotPassword === "function") { await st.forgotPassword(fEmail.trim()); }
   setFMsg({t:"إن كان الحساب موجوداً، فسيصلك رابط إعادة التعيين على بريدك.",c:"#10B981"});
  } catch(e) { setFMsg({t:"إن كان الحساب موجوداً، فسيصلك رابط إعادة التعيين على بريدك.",c:"#10B981"}); }
  setFBusy(false);
  };
  const login = async () => {
  if (u === ADMIN_CREDS.username) {
   const inputHash = await sha256Hex(p);
   const adminHash = await getAdminPassHash();
   if (inputHash === adminHash) { onLogin(ADMIN_CREDS); return; }
  }
  // وضع الصيانة: يمنع دخول غير مدير النظام
  const maint = await st.getShared("maintenanceMode_360c").catch(()=>null);
  if (maint && maint.enabled) { setErr(false); setMaintMsg(maint.message||"النظام قيد التحديث، يُرجى المحاولة لاحقاً"); return; }
  const users = await st.get("users_360c") || [];
  const found = users.find(x => x.username === u && x.password === p);
  if (found) onLogin(found); else { setErr(true); setP(""); }
  };
  return (
  <div style={{minHeight:"100vh",background:APP_BG,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'El Messiri',sans-serif",direction:"rtl",padding:20,boxSizing:"border-box"}}>
   <link href="https://fonts.googleapis.com/css2?family=El+Messiri:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet"/>
   <div style={{position:"absolute",inset:0,background:"radial-gradient(ellipse at 25% 15%, rgba(139,92,246,0.13) 0%, transparent 50%), radial-gradient(ellipse at 78% 82%, rgba(6,182,212,0.12) 0%, transparent 50%), radial-gradient(ellipse at 60% 40%, rgba(236,72,153,0.06) 0%, transparent 55%)"}}/>

   <div style={{position:"relative",display:"flex",width:"100%",maxWidth:940,background:"#fff",borderRadius:32,overflow:"hidden",boxShadow:"0 30px 80px rgba(46,127,184,0.22)",flexWrap:"wrap"}}>

  {/* اللوحة الجانبية الترحيبية */}
  <div style={{flex:"1 1 380px",minHeight:520,background:"linear-gradient(150deg,#1D5A8A 0%,#2E7FB8 45%,#4FA3D9 100%)",padding:"44px 38px",position:"relative",overflow:"hidden",display:"flex",flexDirection:"column",justifyContent:"center"}}>
  <div style={{position:"absolute",top:-70,left:-70,width:230,height:230,borderRadius:"50%",background:"rgba(255,255,255,0.09)"}}/>
  <div style={{position:"absolute",bottom:-90,right:-60,width:270,height:270,borderRadius:"50%",background:"rgba(255,255,255,0.06)"}}/>
  <div style={{position:"absolute",top:"38%",right:-40,width:110,height:110,borderRadius:"50%",background:"rgba(255,255,255,0.05)"}}/>

  <div style={{position:"relative"}}>
   <div style={{display:"inline-flex",alignItems:"center",gap:7,background:"rgba(255,255,255,0.18)",borderRadius:24,padding:"6px 15px",marginBottom:22}}>
   <span style={{fontSize:13}}>🎓</span>
   <span style={{fontSize:11,color:"#fff",fontWeight:700}}>شركة الأندلس التعليمية</span>
   </div>
   <h1 style={{color:"#fff",fontSize:33,fontWeight:900,margin:"0 0 10px",lineHeight:1.28,letterSpacing:"-0.8px"}}>
   منصة التطور<br/><span style={{color:"#FFD98A"}}>المهني</span>
   </h1>
   <p style={{color:"rgba(255,255,255,0.86)",fontSize:13,lineHeight:1.85,margin:0,maxWidth:300}}>
   نظام التقييم 360° وخطط التطور المهني — يرافقك خطوة بخطوة نحو التميّز في أدائك المهني.
   </p>
  </div>
  </div>

  {/* نموذج الدخول */}
  <div style={{flex:"1 1 340px",padding:"44px 40px",display:"flex",flexDirection:"column",justifyContent:"center",background:"linear-gradient(170deg,#FFFFFF,#F7FBFF)"}}>
  <LogoImg style={{margin:"0 auto 22px"}} size={22}/>

  {mode==="forgot" ? (
  <>
  <h2 style={{color:"#15385C",margin:"0 0 5px",fontSize:22,fontWeight:900,letterSpacing:"-0.5px",textAlign:"center"}}>نسيت كلمة السر؟ 🔑</h2>
  <p style={{color:"#8CA3BD",fontSize:12,marginBottom:26,fontWeight:500,textAlign:"center"}}>أدخل بريدك (اسم المستخدم) ليصلك رابط إعادة التعيين</p>
  <div style={{textAlign:"right",marginBottom:14}}>
   <label style={{fontSize:11,color:"#5B7A9E",fontWeight:800,display:"block",marginBottom:6}}>📧 البريد الإلكتروني</label>
   <input value={fEmail} type="email" onChange={e=>setFEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submitForgot()} placeholder="name@as.edu.sa"
   style={{width:"100%",padding:"13px 14px",background:"#F4F9FE",border:"1.5px solid #DDE9F5",borderRadius:16,color:"#15385C",fontSize:13,fontWeight:600,boxSizing:"border-box",outline:"none"}}/>
  </div>
  {fMsg&&<div style={{color:fMsg.c,fontSize:12,marginBottom:12,background:`${fMsg.c}12`,borderRadius:14,padding:"10px 14px",border:`1px solid ${fMsg.c}30`,fontWeight:700,textAlign:"center",lineHeight:1.7}}>{fMsg.t}</div>}
  <button onClick={submitForgot} disabled={fBusy} style={{width:"100%",padding:"14px",borderRadius:24,border:"none",background:"linear-gradient(135deg,#1D5A8A,#2E7FB8 60%,#4FA3D9)",color:"#fff",fontWeight:900,fontSize:15,cursor:fBusy?"wait":"pointer",marginTop:6,boxShadow:"0 10px 26px rgba(46,127,184,0.4)"}}>
   {fBusy?"جارٍ الإرسال...":"إرسال رابط إعادة التعيين"}
  </button>
  <button onClick={()=>{setMode("login");setFMsg(null);}} style={{background:"none",border:"none",color:"#2E7FB8",fontSize:12,fontWeight:700,cursor:"pointer",marginTop:18}}>← العودة لتسجيل الدخول</button>
  </>
  ) : (
  <>
  <h2 style={{color:"#15385C",margin:"0 0 5px",fontSize:22,fontWeight:900,letterSpacing:"-0.5px",textAlign:"center"}}>مرحباً بعودتك 👋</h2>
  <p style={{color:"#8CA3BD",fontSize:12,marginBottom:26,fontWeight:500,textAlign:"center"}}>سجّل دخولك لمتابعة ملفك المهني</p>

  {[{l:"اسم المستخدم",v:u,sv:setU,t:"text",ic:"👤"},{l:"كلمة المرور",v:p,sv:setP,t:show?"text":"password",ic:"🔒"}].map((f,i)=>(
   <div key={i} style={{textAlign:"right",marginBottom:14}}>
   <label style={{fontSize:11,color:"#5B7A9E",fontWeight:800,display:"block",marginBottom:6}}>{f.l}</label>
   <div style={{position:"relative",display:"flex",alignItems:"center"}}>
  <span style={{position:"absolute",right:14,fontSize:14,opacity:0.55}}>{f.ic}</span>
  <input value={f.v} type={f.t} onChange={e=>{f.sv(e.target.value);setErr(false);}} onKeyDown={e=>e.key==="Enter"&&login()}
  placeholder={f.l}
  style={{width:"100%",padding:"13px 42px 13px 14px",background:"#F4F9FE",border:`1.5px solid ${err?"#EF4444":"#DDE9F5"}`,borderRadius:16,color:"#15385C",fontSize:13,fontWeight:600,boxSizing:"border-box",outline:"none"}}/>
  {i===1&&<button onClick={()=>setShow(!show)} style={{position:"absolute",left:12,background:"none",border:"none",color:"#8CA3BD",cursor:"pointer",fontSize:14}}>{show?"🙈":"👁"}</button>}
   </div>
   </div>
  ))}

  {err&&<div style={{color:"#EF4444",fontSize:12,marginBottom:12,background:"#EF444412",borderRadius:14,padding:"10px 14px",border:"1px solid #EF444430",fontWeight:700,textAlign:"center"}}>⚠️ بيانات الدخول غير صحيحة</div>}
  {maintMsg&&<div style={{color:"#B45309",fontSize:13,marginBottom:12,background:"#F59E0B12",borderRadius:14,padding:"12px 16px",border:"1px solid #F59E0B40",fontWeight:700,textAlign:"center",lineHeight:1.7}}>🛠️ {maintMsg}</div>}

  <button onClick={login} style={{width:"100%",padding:"14px",borderRadius:24,border:"none",background:"linear-gradient(135deg,#1D5A8A,#2E7FB8 60%,#4FA3D9)",color:"#fff",fontWeight:900,fontSize:15,cursor:"pointer",marginTop:6,boxShadow:"0 10px 26px rgba(46,127,184,0.4)"}}>
   دخول إلى النظام ←
  </button>
  <button onClick={()=>{setMode("forgot");setErr(false);}} style={{background:"none",border:"none",color:"#2E7FB8",fontSize:12,fontWeight:700,cursor:"pointer",marginTop:16}}>نسيت كلمة السر؟</button>
  <p style={{color:"#B6C7DA",fontSize:10,marginTop:16,textAlign:"center"}}>قسم التدريب • الموارد البشرية</p>
  </>
  )}
  </div>

   </div>
  </div>
  );
}

// نموذج تقييم المرؤوسين/المستفيدين — يعرض البنود المعلّمة فقط (party = subordinate | beneficiary)
function RoleEvalForm({ party, targetUser, existingScores, onSave, onCancel }) {
  const [scores,setScores] = useState(existingScores||{});
  const isSub = party==="subordinate";
  const color = isSub ? "#8B5CF6" : "#0891B2";
  const label = isSub ? "تقييم الرئيس المباشر" : "تقييم مقدّم الخدمة";
  const icon = isSub ? "⬆️" : "🎯";
  // جدارات الوظيفة التي فيها بنود معلّمة لهذا الطرف
  const comps = (getActiveJobs()[targetUser.job]||[]).filter(c => itemsFor(c, party).length>0);
  const setItemScore = (comp,idx,val) => setScores(prev=>{
    const cur = prev[comp]||{};
    return {...prev,[comp]:{...cur,[idx]: cur[idx]===val ? 0 : val}};
  });
  const totalItems = comps.reduce((s,c)=>s+itemsFor(c,party).length,0);
  const scoredItems = comps.reduce((s,c)=>s+itemsFor(c,party).filter(idx=>(scores[c]?.[idx]||0)>0).length,0);

  return (
  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center",padding:12}}>
   <div style={{background:"#FFFFFF",border:`1px solid ${color}50`,borderRadius:20,width:"100%",maxWidth:760,maxHeight:"95vh",overflowY:"auto",padding:24}}>
   <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16,position:"sticky",top:0,background:"#FFFFFF",paddingBottom:14,borderBottom:`1px solid ${color}20`}}>
   <div>
   <div style={{fontWeight:900,fontSize:15,color:"#15385C"}}>{icon} {label}</div>
   <div style={{fontSize:12,color:"#5B7A9E",marginTop:3}}>{targetUser.name} — {ROLES_LIST[targetUser.role]}</div>
   </div>
   <div style={{display:"flex",gap:8,alignItems:"center"}}>
   <div style={{background:`${color}20`,borderRadius:20,padding:"4px 12px",fontSize:11,color,fontWeight:700}}>{scoredItems}/{totalItems} بند</div>
   <button onClick={onCancel} style={{background:"none",border:"none",color:"#5B7A9E",fontSize:22,cursor:"pointer"}}>✕</button>
   </div>
   </div>
   <div style={{background:`${color}0D`,border:`1px solid ${color}25`,borderRadius:10,padding:"8px 14px",marginBottom:16,fontSize:12,color:"#5B7A9E",lineHeight:1.7}}>
   💡 قيّم كل بند من 1 إلى 5. تقييمك <strong style={{color}}>سرّي</strong> — تظهر النتيجة كمتوسط دون هويتك (لا تظهر إلا بمُقيّمَين فأكثر).
   </div>
   {comps.length===0&&(
   <div style={{textAlign:"center",padding:36,color:"#5B7A9E",background:"#F4F9FE",borderRadius:12}}>لم يحدّد مدير النظام بنوداً لهذا التقييم بعد.</div>
   )}
   {comps.map(c=>{
   const marked = itemsFor(c, party);
   const items = getActiveComps()[c]?.items||[];
   return (
   <div key={c} style={{marginBottom:14,border:`1px solid ${color}20`,borderRadius:12,overflow:"hidden"}}>
   <div style={{padding:"9px 16px",background:`${color}12`,fontSize:13,color,fontWeight:800}}>● {c}</div>
   <div style={{padding:"8px 14px",background:"#F4F9FE"}}>
   {marked.map(idx=>{
   const s = scores[c]?.[idx]||0;
   return (
   <div key={idx} style={{background:"#FFFFFF",border:"1px solid #EDF4FC",borderRadius:8,padding:"10px 12px",marginBottom:4,display:"flex",alignItems:"center",gap:10}}>
   <div style={{flex:1,fontSize:11,color:"#5B7A9E",lineHeight:1.6}}>{idx+1}. {items[idx]||""}</div>
   <div style={{display:"flex",gap:4}}>
   {[1,2,3,4,5].map(v=>(
   <button key={v} onClick={()=>setItemScore(c,idx,v)} style={{width:30,height:30,borderRadius:"50%",border:`2px solid ${s===v?SCORE_COLORS[v]:"#C7DBF0"}`,background:s===v?SCORE_COLORS[v]:"transparent",color:s===v?"#fff":"#5B7A9E",fontWeight:700,fontSize:11,cursor:"pointer"}}>{v}</button>
   ))}
   </div>
   </div>
   );
   })}
   </div>
   </div>
   );
   })}
   <div style={{display:"flex",gap:8,marginTop:8}}>
   <button onClick={onCancel} style={{flex:1,padding:"12px",borderRadius:12,border:"1px solid #C7DBF0",background:"#fff",color:"#5B7A9E",fontWeight:700,fontSize:13,cursor:"pointer"}}>إلغاء</button>
   <button onClick={()=>onSave(scores)} disabled={scoredItems===0} style={{flex:2,padding:"12px",borderRadius:12,border:"none",background:scoredItems>0?`linear-gradient(135deg,${color},${color}CC)`:"#CBD5E1",color:"#fff",fontWeight:700,fontSize:13,cursor:scoredItems>0?"pointer":"not-allowed"}}>💾 حفظ التقييم</button>
   </div>
   </div>
  </div>
  );
}

function EvalForm({ partyKey, targetUser, existingScores, onSave, onCancel, locks, onLock, lockKeyOverride }) {
  const party = EVAL_PARTIES.find(p=>p.key===partyKey);
  const allowedCats = PARTY_CATS[partyKey] || [];
  const comps = (getActiveJobs()[targetUser.job]||[]).filter(c => allowedCats.includes(getCat(c)));
  const [scores,setScores] = useState(existingScores||{});
  const [witnesses,setWitnesses] = useState(existingScores?.__witnesses||{});
  const requiresWitness = ["supervisor","stage_mgr"].includes(partyKey);
  const lockKey = lockKeyOverride || `${targetUser.id}__${partyKey}`;
  const isLocked = !!(locks && locks[lockKey]);
  const [showLockConfirm, setShowLockConfirm] = useState(false);

  const setItemScore = (comp,idx,val) => setScores(prev=>{
  const cur = prev[comp]||{};
  const updated = {...cur,[idx]: cur[idx]===val ? 0 : val};
  if (updated[idx] !== 5 && requiresWitness) {
   setWitnesses(pw=>{ const nw={...pw}; delete nw[`${comp}__${idx}`]; return nw; });
  }
  return {...prev,[comp]:updated};
  });

  const setWitness = (comp,idx,text) => setWitnesses(prev=>({...prev,[`${comp}__${idx}`]:text}));

  const handleSave = () => {
  const payload = {...scores, __witnesses: witnesses};
  onSave(payload);
  };

  const totalItems = comps.reduce((s,c)=>(getActiveComps()[c]?.items?.length||0)+s,0);
  const scoredItems = comps.reduce((s,c)=>{
  const items = getActiveComps()[c]?.items||[];
  return s+items.filter((_,i)=>(scores[c]?.[i]||0)>0).length;
  },0);

  const catLabel = { أساسية:"الجدارات الأساسية", عامة:"الجدارات العامة/الإدارية/القيادية", فنية:"الجدارات الفنية التخصصية" };
  const catWeightNote = { أساسية:"وزنك في هذه الفئة", عامة:"وزنك في هذه الفئة", فنية:"وزنك في هذه الفئة" };

  return (
  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center",padding:12}}>
   <div style={{background:"#FFFFFF",border:`1px solid ${party.color}50`,borderRadius:20,width:"100%",maxWidth:800,maxHeight:"95vh",overflowY:"auto",padding:24}}>
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16,position:"sticky",top:0,background:"#FFFFFF",paddingBottom:14,borderBottom:`1px solid ${party.color}20`,zIndex:10}}>
  <div>
   <div style={{fontWeight:900,fontSize:15,color:"#15385C"}}>{party.icon} {party.label}{isR2Active(targetUser.id)?<span style={{fontSize:11,color:"#D97706",background:"#F59E0B15",padding:"2px 10px",borderRadius:20,marginRight:8}}>🔁 التقييم الثاني</span>:null}</div>
   <div style={{fontSize:12,color:"#5B7A9E",marginTop:3}}>{targetUser.name} — {targetUser.job}</div>
   <div style={{display:"flex",gap:6,marginTop:6,flexWrap:"wrap"}}>
   {allowedCats.map(cat=>(
  <span key={cat} style={{fontSize:10,padding:"2px 8px",borderRadius:20,background:`${CAT_COLORS[cat]}18`,color:CAT_COLORS[cat],border:`1px solid ${CAT_COLORS[cat]}30`,fontWeight:700}}>
  {cat} • {PARTY_CAT_WEIGHTS[partyKey][cat]}%
  </span>
   ))}
   </div>
  </div>
  <div style={{display:"flex",gap:8,alignItems:"center"}}>
   <div style={{background:`${party.color}20`,borderRadius:20,padding:"4px 12px",fontSize:11,color:party.color,fontWeight:700}}>{scoredItems}/{totalItems} بند</div>
   <button onClick={onCancel} style={{background:"none",border:"none",color:"#5B7A9E",fontSize:22,cursor:"pointer"}}>✕</button>
  </div>
  </div>

  {/* بنر القفل */}
  {isLocked ? (
  <div style={{background:"#EF444412",border:"2px solid #EF444440",borderRadius:12,padding:"14px 18px",marginBottom:16,display:"flex",alignItems:"center",gap:12}}>
   <span style={{fontSize:28}}>🔒</span>
   <div>
   <div style={{fontSize:13,fontWeight:900,color:"#EF4444"}}>تم تأكيد التقييم وقفله</div>
   <div style={{fontSize:11,color:"#5B7A9E",marginTop:3}}>لا يمكن التعديل — يحق لمدير الفرع أو مدير النظام فتح القفل فقط</div>
   {locks[lockKey]?.lockedAt&&<div style={{fontSize:10,color:"#5B7A9E",marginTop:2}}>تاريخ القفل: {new Date(locks[lockKey].lockedAt).toLocaleDateString("ar-SA")}</div>}
   </div>
  </div>
  ) : (
  <div style={{background:"#DDE9F5",borderRadius:10,padding:"8px 14px",marginBottom:16,fontSize:12,color:"#5B7A9E",lineHeight:1.6}}>
   💡 أنت تُقيّم الجدارات <strong style={{color:"#94A3B8"}}>{allowedCats.join(" و")}</strong> فقط — قيّم كل بند من 1 إلى 5
  </div>
  )}

  {comps.length===0&&(
  <div style={{textAlign:"center",padding:40,color:"#5B7A9E",background:"#F4F9FE",borderRadius:12,marginBottom:14}}>
   <div style={{fontSize:32,marginBottom:10}}>📋</div>
   <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>لا توجد جدارات ضمن نطاق تقييمك لهذا الموظف</div>
   <div style={{fontSize:11,color:"#5B7A9E"}}>مسمى الموظف «{targetUser.job}» لا يحتوي جدارات من فئة ({allowedCats.join(" أو ")}). راجع مصفوفة الجدارات في لوحة مدير النظام.</div>
  </div>
  )}

  {allowedCats.map(cat=>{
  const catComps = comps.filter(c=>getCat(c)===cat);
  if (!catComps.length) return null;
  const col = CAT_COLORS[cat];
  const w = PARTY_CAT_WEIGHTS[partyKey][cat];
  return (
   <div key={cat} style={{marginBottom:18}}>
   <div style={{padding:"9px 16px",background:`${col}15`,borderRadius:"12px 12px 0 0",border:`1px solid ${col}30`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
  <span style={{fontSize:13,color:col,fontWeight:800}}>● {catLabel[cat]}</span>
  <span style={{fontSize:11,color:col,fontWeight:700,background:`${col}20`,padding:"2px 10px",borderRadius:20}}>وزن {w}%</span>
   </div>
   {catComps.map(c=>{
  const items = getActiveComps()[c]?.items||[];
  const itemScores = scores[c]||{};
  const compScore = calcCompScore(c, itemScores);
  const lv = compScore !== null ? getLevel(compScore) : null;
  return (
  <div key={c} style={{border:`1px solid ${col}15`,borderTop:"none",background:"#F4F9FE",padding:"12px 16px",marginBottom:2}}>
  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
  <div style={{flex:1}}>
   <span style={{fontWeight:700,fontSize:13,color:"#334155"}}>{c}</span>
   <span style={{fontSize:10,color:"#5B7A9E",marginRight:8}}>({items.length} بنود)</span>
  </div>
  {lv&&(
   <div style={{background:`${lv.color}18`,borderRadius:8,padding:"3px 10px",display:"flex",gap:6,alignItems:"center"}}>
   <span style={{fontSize:12,fontWeight:900,color:lv.color,fontFamily:MONO}}>{compScore.toFixed(2)}</span>
   <span style={{fontSize:10,color:lv.color}}>{lv.label}</span>
   </div>
  )}
  </div>
  {items.map((item,idx)=>{
  const s = itemScores[idx]||0;
  const witnessKey = `${c}__${idx}`;
  const witnessText = witnesses[witnessKey]||"";
  const needsWitness = requiresWitness && s===5;
  const hasWitness = witnessText.trim().length>0;
  return (
   <div key={idx} style={{background:idx%2===0?"#FFFFFF":"#F4F9FE",border:"1px solid #EDF4FC",borderRadius:8,padding:"10px 12px",marginBottom:4}}>
   <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
   <div style={{flex:1}}>
   <div style={{fontSize:11,color:"#5B7A9E",lineHeight:1.6}}>{idx+1}. {item}</div>
   </div>
   <div style={{display:"flex",gap:4,flexShrink:0}}>
   {[1,2,3,4,5].map(v=>(
  <button key={v} onClick={()=>!isLocked&&setItemScore(c,idx,v)}
  style={{width:30,height:30,borderRadius:"50%",border:`2px solid ${s===v?SCORE_COLORS[v]:"#C7DBF0"}`,background:s===v?SCORE_COLORS[v]:"transparent",color:s===v?"#fff":"#5B7A9E",fontWeight:700,fontSize:11,cursor:isLocked?"not-allowed":"pointer",transition:"all 0.15s",flexShrink:0,opacity:isLocked?0.6:1}}>
  {v}
  </button>
   ))}
   </div>
   {s>0&&<div style={{width:54,fontSize:9,color:SCORE_COLORS[s],fontWeight:700,textAlign:"center",flexShrink:0,lineHeight:1.3}}>{SCORE_LABELS[s]}</div>}
   </div>
   {/* حقل الشاهد عند الدرجة 5 */}
   {needsWitness&&(
   <div style={{marginTop:8,padding:"10px 12px",background:"#10B98108",border:`1px solid ${hasWitness?"#10B98140":"#F59E0B40"}`,borderRadius:8}}>
   <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
  <span style={{fontSize:14}}>📎</span>
  <span style={{fontSize:11,color:hasWitness?"#10B981":"#F59E0B",fontWeight:700}}>
  {hasWitness?"✓ تم إدراج الشاهد":"مطلوب: أدرج شاهداً على الدرجة الكاملة"}
  </span>
   </div>
   <input
  value={witnessText}
  onChange={e=>!isLocked&&setWitness(c,idx,e.target.value)}
  readOnly={isLocked}
  placeholder="صِف الدليل أو الشاهد الذي يُثبت هذه الدرجة (مثال: محضر اجتماع، نموذج، نتيجة قابلة للقياس...)"
  style={{width:"100%",padding:"8px 10px",background:"#FFFFFF",border:`1px solid ${hasWitness?"#10B98130":"#F59E0B30"}`,borderRadius:7,color:"#1E293B",fontSize:11,boxSizing:"border-box",outline:"none"}}
   />
   </div>
   )}
   </div>
  );
  })}
  </div>
  );
   })}
   </div>
  );
  })}

  {/* مودال تأكيد القفل */}
  {showLockConfirm&&(
  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:700,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
   <div style={{background:"#FFFFFF",border:"2px solid #EF444440",borderRadius:20,padding:28,maxWidth:380,textAlign:"center",direction:"rtl"}}>
   <div style={{fontSize:44,marginBottom:12}}>🔒</div>
   <div style={{fontSize:16,fontWeight:900,color:"#15385C",marginBottom:8}}>تأكيد قفل التقييم</div>
   <div style={{fontSize:12,color:"#5B7A9E",marginBottom:20,lineHeight:1.7}}>
  بعد القفل <span style={{color:"#EF4444",fontWeight:700}}>لن تتمكن من التعديل</span>.<br/>
  يحق فتح القفل لمدير الفرع أو مدير النظام فقط.
   </div>
   <div style={{display:"flex",gap:10}}>
  <button onClick={()=>setShowLockConfirm(false)} style={{flex:1,padding:"10px",borderRadius:10,border:"1px solid #C7DBF0",background:"transparent",color:"#5B7A9E",cursor:"pointer"}}>إلغاء</button>
  <button onClick={()=>{
  handleSave();
  onLock && onLock(lockKey);
  setShowLockConfirm(false);
  }} style={{flex:2,padding:"10px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#DC2626,#EF4444)",color:"#fff",fontWeight:700,cursor:"pointer",fontSize:13}}>
  🔒 تأكيد القفل
  </button>
   </div>
   </div>
  </div>
  )}

  <div style={{display:"flex",gap:10,marginTop:8,position:"sticky",bottom:0,background:"#FFFFFF",padding:"12px 0",borderTop:"1px solid #C7DBF0"}}>
  <button onClick={onCancel} style={{flex:1,padding:"10px",borderRadius:10,border:"1px solid #C7DBF0",background:"transparent",color:"#5B7A9E",cursor:"pointer"}}>إغلاق</button>
  {!isLocked ? (
   <>
   <button onClick={handleSave} disabled={scoredItems===0}
  style={{flex:2,padding:"10px",borderRadius:10,border:"none",background:scoredItems>0?"linear-gradient(135deg,#10B981,#059669)":"#DDE9F5",color:scoredItems>0?"#fff":"#C7DBF0",fontWeight:700,cursor:scoredItems>0?"pointer":"default",fontSize:13}}>
  💾 حفظ مؤقت ({scoredItems} بند)
   </button>
   <button onClick={()=>scoredItems>0&&setShowLockConfirm(true)} disabled={scoredItems===0}
  style={{flex:2,padding:"10px",borderRadius:10,border:"none",background:scoredItems>0?"linear-gradient(135deg,#DC2626,#EF4444)":"#DDE9F5",color:scoredItems>0?"#fff":"#C7DBF0",fontWeight:700,cursor:scoredItems>0?"pointer":"default",fontSize:13}}>
  🔒 حفظ وقفل
   </button>
   </>
  ) : (
   <div style={{flex:3,padding:"10px",borderRadius:10,background:"#EF444415",border:"1px solid #EF444430",color:"#EF4444",fontWeight:700,fontSize:13,textAlign:"center"}}>
   🔒 التقييم مقفول — التعديل محظور
   </div>
  )}
  </div>
   </div>
  </div>
  );
}

// د-9: محرّر الشهادات الاحترافية (مدير النظام) — في مكتبة المصادر، بحقول: فئة/اسم/رابط/تكلفة
function ProfCertsManager({ certs, onSave }) {
  const [list,setList] = useState((certs&&certs.length?certs:DEFAULT_PROF_CERTS).map(normCert));
  const [nw,setNw] = useState({ category:CERT_CATEGORIES[0], name:"", url:"", cost:"" });
  const setNwF = (k,v)=>setNw(p=>({...p,[k]:v}));
  const add = () => { if(nw.name.trim()){ setList([...list,{...nw,name:nw.name.trim()}]); setNw({category:CERT_CATEGORIES[0],name:"",url:"",cost:""}); } };
  const iS = {padding:"8px 10px",background:"#F4F9FE",border:"1px solid #DDE9F5",borderRadius:8,color:"#15385C",fontSize:12,boxSizing:"border-box",width:"100%"};
  return (
  <div style={{background:"#FFFFFF",border:"1px solid #8B5CF625",borderRadius:14,padding:16,marginTop:16}}>
   <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
   <span style={{fontSize:20}}>🎖️</span>
   <div>
   <div style={{fontSize:14,fontWeight:900,color:"#7C3AED"}}>الشهادات الاحترافية</div>
   <div style={{fontSize:11,color:"#5B7A9E"}}>يختار منها القياديون والتخصصيون في خططهم (مع بقاء خيار «أخرى» للنص الحر)</div>
   </div>
   </div>
   {/* قائمة الشهادات الحالية */}
   <div style={{marginBottom:12}}>
   {list.length===0&&<div style={{fontSize:12,color:"#8CA3BD",padding:10}}>لا شهادات — أضِف أدناه.</div>}
   {list.map((c,i)=>(
   <div key={i} style={{display:"flex",alignItems:"center",gap:8,background:"#F9FAFB",border:"1px solid #EDF4FC",borderRadius:10,padding:"8px 12px",marginBottom:5}}>
   <span style={{fontSize:9,color:"#7C3AED",background:"#8B5CF612",padding:"2px 8px",borderRadius:10,fontWeight:700,flexShrink:0}}>{c.category}</span>
   <div style={{flex:1,minWidth:0}}>
   <div style={{fontSize:12,fontWeight:700,color:"#15385C"}}>{c.name}</div>
   <div style={{fontSize:10,color:"#8CA3BD"}}>{c.cost?`💰 ${c.cost}`:""}{c.url?` • 🔗 ${c.url.slice(0,30)}`:""}</div>
   </div>
   <button onClick={()=>setList(list.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:"#EF4444",fontSize:15,cursor:"pointer",flexShrink:0}}>✕</button>
   </div>
   ))}
   </div>
   {/* إضافة شهادة جديدة */}
   <div style={{background:"#F4F9FE",borderRadius:10,padding:12}}>
   <div style={{fontSize:11,fontWeight:800,color:"#5B7A9E",marginBottom:8}}>+ إضافة شهادة</div>
   <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
   <select value={nw.category} onChange={e=>setNwF("category",e.target.value)} style={iS}>{CERT_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}</select>
   <input value={nw.name} onChange={e=>setNwF("name",e.target.value)} placeholder="اسم الشهادة *" style={iS}/>
   <input value={nw.url} onChange={e=>setNwF("url",e.target.value)} placeholder="رابط التفاصيل" style={iS}/>
   <input value={nw.cost} onChange={e=>setNwF("cost",e.target.value)} placeholder="التكلفة (اختياري)" style={iS}/>
   </div>
   <button onClick={add} style={{width:"100%",padding:"9px",borderRadius:8,border:"none",background:"#8B5CF6",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>+ إضافة الشهادة</button>
   </div>
   <div style={{display:"flex",gap:8,marginTop:12}}>
   <button onClick={()=>onSave(list)} style={{flex:1,padding:"11px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#059669,#10B981)",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer"}}>💾 حفظ الشهادات</button>
   <button onClick={()=>setList(DEFAULT_PROF_CERTS)} style={{padding:"11px 16px",borderRadius:10,border:"1px solid #F9731640",background:"#F9731610",color:"#F97316",fontWeight:700,fontSize:12,cursor:"pointer"}}>↺ الافتراضية</button>
   </div>
  </div>
  );
}

function CompetenciesEditor({ comps, jobs, onSaveComps, onSaveJobs, onReset, roleItems, onSaveRoleItems }) {
  const [localComps, setLocalComps] = useState(() => JSON.parse(JSON.stringify(comps)));
  const [localRoleItems, setLocalRoleItems] = useState(() => JSON.parse(JSON.stringify(roleItems||{})));
  // تبديل تعليم بند لطرف (subordinate/beneficiary)
  const toggleRoleItem = (comp, idx, party) => setLocalRoleItems(p => {
    const c = {...(p[comp]||{})};
    const arr = new Set(c[party]||[]);
    if (arr.has(idx)) arr.delete(idx); else arr.add(idx);
    c[party] = [...arr].sort((a,b)=>a-b);
    return {...p, [comp]: c};
  });
  const isMarked = (comp, idx, party) => (localRoleItems[comp]?.[party]||[]).includes(idx);
  const [localJobs,  setLocalJobs]  = useState(() => JSON.parse(JSON.stringify(jobs)));
  const [subTab,     setSubTab]     = useState("comps");
  const [expandComp, setExpandComp] = useState(null);
  const [expandJob,  setExpandJob]  = useState(null);
  const [search,     setSearch]     = useState("");
  const [filterCat,  setFilterCat]  = useState("الكل");
  const [showReset,  setShowReset]  = useState(false);
  const [newCompName, setNewCompName] = useState("");
  const [newCompCat,  setNewCompCat]  = useState("عامة");
  const [newJobName,  setNewJobName]  = useState("");

  const CAT_OPTS = ["أساسية","عامة","فنية"];

  const addComp = () => {
  const name = newCompName.trim();
  if (!name || localComps[name]) return;
  setLocalComps(p=>({...p,[name]:{cat:newCompCat,items:[]}}));
  setNewCompName(""); setExpandComp(name);
  };

  const deleteComp = (name) => {
  setLocalComps(p=>{ const n={...p}; delete n[name]; return n; });
  setLocalJobs(p=>{ const n={...p}; Object.keys(n).forEach(j=>{ n[j]=n[j].filter(c=>c!==name); }); return n; });
  if(expandComp===name) setExpandComp(null);
  };

  const renameComp = (oldName, newName) => {
  const nn=newName.trim(); if(!nn||nn===oldName) return;
  setLocalComps(p=>{ const n={...p}; n[nn]=n[oldName]; delete n[oldName]; return n; });
  setLocalJobs(p=>{ const n={...p}; Object.keys(n).forEach(j=>{ n[j]=n[j].map(c=>c===oldName?nn:c); }); return n; });
  setExpandComp(nn);
  };

  const updateCompCat  = (name,cat) => setLocalComps(p=>({...p,[name]:{...p[name],cat}}));
  const addItem        = (c)        => setLocalComps(p=>({...p,[c]:{...p[c],items:[...(p[c].items||[]),""]} }));
  const updateItem     = (c,i,v)   => setLocalComps(p=>{ const it=[...(p[c].items||[])]; it[i]=v; return {...p,[c]:{...p[c],items:it}}; });
  const deleteItem     = (c,i)     => setLocalComps(p=>({...p,[c]:{...p[c],items:(p[c].items||[]).filter((_,x)=>x!==i)}}));
  const moveItem       = (c,i,d)   => setLocalComps(p=>{ const it=[...(p[c].items||[])]; const t=i+d; if(t<0||t>=it.length)return p; [it[i],it[t]]=[it[t],it[i]]; return {...p,[c]:{...p[c],items:it}}; });

  const addJob         = ()        => { const n=newJobName.trim(); if(!n||localJobs[n])return; setLocalJobs(p=>({...p,[n]:[]})); setNewJobName(""); setExpandJob(n); };
  const deleteJob      = (j)       => { setLocalJobs(p=>{ const n={...p}; delete n[j]; return n; }); if(expandJob===j)setExpandJob(null); };
  const toggleJobComp  = (j,c)     => setLocalJobs(p=>{ const cur=p[j]||[]; return {...p,[j]:cur.includes(c)?cur.filter(x=>x!==c):[...cur,c]}; });

  const allCompNames = Object.keys(localComps);
  const filtered = allCompNames.filter(c=>{
  const ms=!search||c.includes(search)||(localComps[c].items||[]).some(i=>i.includes(search));
  const mc=filterCat==="الكل"||localComps[c].cat===filterCat;
  return ms&&mc;
  });

  return (
  <div style={{direction:"rtl",fontFamily:"'El Messiri',sans-serif"}}>
   <div style={{background:"#FFFFFF",border:"1px solid #B3D0EA",borderRadius:14,padding:"14px 18px",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
  <div>
  <div style={{fontSize:14,color:"#2E7FB8",fontWeight:900}}>🗂️ مصفوفة الجدارات والمسميات الوظيفية</div>
  <div style={{fontSize:11,color:"#5B7A9E",marginTop:3}}>{allCompNames.length} جدارة • {Object.keys(localJobs).length} مسمى وظيفي</div>
  </div>
  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
  <button onClick={()=>setShowReset(true)} style={{padding:"6px 14px",borderRadius:20,border:"1px solid #F97316",background:"#F9731610",color:"#F97316",fontSize:11,cursor:"pointer",fontWeight:700}}>↺ إعادة الضبط</button>
  <button onClick={()=>{onSaveComps(localComps); if(onSaveRoleItems)onSaveRoleItems(localRoleItems);}} style={{padding:"6px 14px",borderRadius:20,border:"none",background:"linear-gradient(135deg,#059669,#10B981)",color:"#fff",fontSize:11,cursor:"pointer",fontWeight:700}}>💾 حفظ الجدارات</button>
  <button onClick={()=>onSaveJobs(localJobs)} style={{padding:"6px 14px",borderRadius:20,border:"none",background:"linear-gradient(135deg,#1D5A8A,#2E7FB8)",color:"#fff",fontSize:11,cursor:"pointer",fontWeight:700}}>💾 حفظ المسميات</button>
  </div>
   </div>

   <div style={{display:"flex",gap:6,marginBottom:14}}>
  {[{k:"comps",l:"📋 الجدارات والبنود"},{k:"jobs",l:"💼 المسميات الوظيفية"}].map(t=>(
  <button key={t.k} onClick={()=>setSubTab(t.k)} style={{padding:"8px 18px",borderRadius:10,border:`1px solid ${subTab===t.k?"#3B82F6":"#DDE9F5"}`,background:subTab===t.k?"#3B82F620":"#FFFFFF",color:subTab===t.k?"#3B82F6":"#5B7A9E",fontSize:12,fontWeight:700,cursor:"pointer"}}>{t.l}</button>
  ))}
   </div>

   {subTab==="comps"&&(
  <div>
  <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
   <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 ابحث في الجدارات أو البنود..." style={{flex:1,minWidth:180,padding:"8px 12px",background:"#FFFFFF",border:"1px solid #C7DBF0",borderRadius:8,color:"#1E293B",fontSize:12}}/>
   {["الكل",...CAT_OPTS].map(cat=>(
   <button key={cat} onClick={()=>setFilterCat(cat)} style={{padding:"6px 14px",borderRadius:20,border:`1px solid ${filterCat===cat?(CAT_COLORS[cat]||"#3B82F6")+"60":"#C7DBF0"}`,background:filterCat===cat?`${CAT_COLORS[cat]||"#3B82F6"}20`:"transparent",color:filterCat===cat?(CAT_COLORS[cat]||"#3B82F6"):"#5B7A9E",fontSize:11,cursor:"pointer",fontWeight:filterCat===cat?700:400}}>{cat}</button>
   ))}
  </div>

  <div style={{background:"#FFFFFF",border:"1px dashed #B3D0EA",borderRadius:12,padding:"12px 16px",marginBottom:14,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
   <span style={{fontSize:12,color:"#5B7A9E",fontWeight:700,flexShrink:0}}>+ إضافة جدارة:</span>
   <input value={newCompName} onChange={e=>setNewCompName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addComp()} placeholder="اسم الجدارة الجديدة..." style={{flex:1,minWidth:160,padding:"7px 10px",background:"#F4F9FE",border:"1px solid #C7DBF0",borderRadius:7,color:"#1E293B",fontSize:12}}/>
   <select value={newCompCat} onChange={e=>setNewCompCat(e.target.value)} style={{padding:"7px 10px",background:"#F4F9FE",border:"1px solid #C7DBF0",borderRadius:7,color:"#1E293B",fontSize:12}}>
   {CAT_OPTS.map(c=><option key={c} value={c}>{catName(c)}</option>)}
   </select>
   <button onClick={addComp} disabled={!newCompName.trim()} style={{padding:"7px 16px",borderRadius:7,border:"none",background:newCompName.trim()?"linear-gradient(135deg,#1D5A8A,#2E7FB8)":"#C7DBF0",color:newCompName.trim()?"#fff":"#334155",fontWeight:700,fontSize:12,cursor:"pointer"}}>إضافة</button>
  </div>

  <div style={{display:"flex",flexDirection:"column",gap:6}}>
   {filtered.length===0&&<div style={{textAlign:"center",padding:30,color:"#5B7A9E"}}>لا توجد نتائج</div>}
   {filtered.map(cn=>{
   const comp=localComps[cn]; const isOpen=expandComp===cn; const col=CAT_COLORS[comp.cat]||"#5B7A9E";
   return(
  <div key={cn} style={{background:"#FFFFFF",border:`1px solid ${isOpen?col+"40":"#DDE9F5"}`,borderRadius:12,overflow:"hidden"}}>
  <div style={{padding:"10px 14px",display:"flex",alignItems:"center",gap:8}}>
  <button onClick={()=>setExpandComp(isOpen?null:cn)} style={{background:"none",border:"none",color:"#5B7A9E",fontSize:14,cursor:"pointer",flexShrink:0,padding:0}}>{isOpen?"▲":"▼"}</button>
  {isOpen
  ? <input key={cn+"_inp"} defaultValue={cn} onBlur={e=>renameComp(cn,e.target.value)} onKeyDown={e=>e.key==="Enter"&&e.target.blur()} style={{flex:1,padding:"5px 8px",background:"#F4F9FE",border:"1px solid #B3D0EA",borderRadius:7,color:"#1E293B",fontSize:13,fontWeight:700}}/>
  : <span style={{flex:1,fontSize:13,color:"#334155",fontWeight:700}}>{cn}</span>}
  {isOpen
  ? <select value={comp.cat} onChange={e=>updateCompCat(cn,e.target.value)} style={{padding:"4px 8px",background:"#F4F9FE",border:`1px solid ${col}40`,borderRadius:7,color:col,fontSize:11,fontWeight:700}}>{CAT_OPTS.map(c=><option key={c} value={c}>{catName(c)}</option>)}</select>
  : <span style={{fontSize:10,padding:"2px 8px",borderRadius:20,background:`${col}15`,color:col,border:`1px solid ${col}25`,flexShrink:0}}>{comp.cat}</span>}
  <span style={{fontSize:10,color:"#5B7A9E",flexShrink:0}}>{(comp.items||[]).length} بنود</span>
  <button onClick={()=>deleteComp(cn)} style={{background:"none",border:"none",color:"#EF4444",fontSize:15,cursor:"pointer",flexShrink:0,padding:"2px 6px",borderRadius:5}} title="حذف">🗑</button>
  </div>
  {isOpen&&(
  <div style={{padding:"0 14px 14px",borderTop:`1px solid ${col}15`}}>
  {(comp.items||[]).map((item,idx)=>(
   <div key={idx} style={{display:"flex",gap:5,alignItems:"center",marginBottom:7,marginTop:idx===0?10:0}}>
   <span style={{width:22,fontSize:11,color:"#5B7A9E",flexShrink:0,textAlign:"center"}}>{idx+1}</span>
   <input value={item} onChange={e=>updateItem(cn,idx,e.target.value)} style={{flex:1,minWidth:0,padding:"9px 12px",background:"#F4F9FE",border:"1px solid #C7DBF0",borderRadius:8,color:"#1E293B",fontSize:12.5,lineHeight:1.5}}/>
   <button onClick={()=>toggleRoleItem(cn,idx,"subordinate")} title="بند تقييم المرؤوسين" style={{background:isMarked(cn,idx,"subordinate")?"#8B5CF6":"transparent",border:`1px solid ${isMarked(cn,idx,"subordinate")?"#8B5CF6":"#C7DBF0"}`,color:isMarked(cn,idx,"subordinate")?"#fff":"#8B5CF6",cursor:"pointer",fontSize:11,padding:"3px 6px",borderRadius:6,flexShrink:0,fontWeight:700}}>⬆️</button>
   <button onClick={()=>toggleRoleItem(cn,idx,"beneficiary")} title="بند تقييم المستفيدين" style={{background:isMarked(cn,idx,"beneficiary")?"#0891B2":"transparent",border:`1px solid ${isMarked(cn,idx,"beneficiary")?"#0891B2":"#C7DBF0"}`,color:isMarked(cn,idx,"beneficiary")?"#fff":"#0891B2",cursor:"pointer",fontSize:11,padding:"3px 6px",borderRadius:6,flexShrink:0,fontWeight:700}}>🎯</button>
   <button onClick={()=>moveItem(cn,idx,-1)} disabled={idx===0} style={{background:"none",border:"none",color:idx===0?"#15385C":"#5B7A9E",cursor:idx===0?"default":"pointer",fontSize:13,padding:"2px 4px"}}>↑</button>
   <button onClick={()=>moveItem(cn,idx,1)} disabled={idx===(comp.items||[]).length-1} style={{background:"none",border:"none",color:idx===(comp.items||[]).length-1?"#15385C":"#5B7A9E",cursor:idx===(comp.items||[]).length-1?"default":"pointer",fontSize:13,padding:"2px 4px"}}>↓</button>
   <button onClick={()=>deleteItem(cn,idx)} style={{background:"none",border:"none",color:"#EF4444",fontSize:13,cursor:"pointer",padding:"2px 4px"}}>✕</button>
   </div>
  ))}
  <button onClick={()=>addItem(cn)} style={{marginTop:8,padding:"6px 14px",borderRadius:7,border:"1px dashed #B3D0EA",background:"transparent",color:"#3B82F6",fontSize:11,cursor:"pointer",fontWeight:700}}>+ إضافة بند</button>
  </div>
  )}
  </div>
   );
   })}
  </div>
  </div>
   )}

   {subTab==="jobs"&&(
  <div>
  <div style={{background:"#FFFFFF",border:"1px dashed #B3D0EA",borderRadius:12,padding:"12px 16px",marginBottom:14,display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
   <span style={{fontSize:12,color:"#5B7A9E",fontWeight:700,flexShrink:0}}>+ إضافة مسمى وظيفي:</span>
   <input value={newJobName} onChange={e=>setNewJobName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addJob()} placeholder="اسم المسمى الوظيفي..." style={{flex:1,minWidth:160,padding:"7px 10px",background:"#F4F9FE",border:"1px solid #C7DBF0",borderRadius:7,color:"#1E293B",fontSize:12}}/>
   <button onClick={addJob} disabled={!newJobName.trim()} style={{padding:"7px 16px",borderRadius:7,border:"none",background:newJobName.trim()?"linear-gradient(135deg,#1D5A8A,#2E7FB8)":"#C7DBF0",color:newJobName.trim()?"#fff":"#334155",fontWeight:700,fontSize:12,cursor:"pointer"}}>إضافة</button>
  </div>
  <div style={{display:"flex",flexDirection:"column",gap:8}}>
   {Object.keys(localJobs).map(jn=>{
   const jc=localJobs[jn]||[]; const isOpen=expandJob===jn;
   return(
  <div key={jn} style={{background:"#FFFFFF",border:`1px solid ${isOpen?"#3B82F640":"#DDE9F5"}`,borderRadius:12,overflow:"hidden"}}>
  <div style={{padding:"10px 14px",display:"flex",alignItems:"center",gap:8,cursor:"pointer"}} onClick={()=>setExpandJob(isOpen?null:jn)}>
  <span style={{color:"#5B7A9E",fontSize:14}}>{isOpen?"▲":"▼"}</span>
  <span style={{flex:1,fontSize:13,color:"#334155",fontWeight:700}}>💼 {jn}</span>
  <span style={{fontSize:10,color:"#3B82F6",background:"#3B82F615",padding:"2px 8px",borderRadius:20,border:"1px solid #3B82F625"}}>{jc.length} جدارة</span>
  <button onClick={e=>{e.stopPropagation();deleteJob(jn);}} style={{background:"none",border:"none",color:"#EF4444",fontSize:14,cursor:"pointer",padding:"2px 6px"}} title="حذف">🗑</button>
  </div>
  {isOpen&&(
  <div style={{padding:"0 14px 14px",borderTop:"1px solid #DDE9F5"}}>
  <div style={{fontSize:11,color:"#5B7A9E",marginBottom:10,marginTop:8}}>اختر الجدارات ({jc.length}/{allCompNames.length}):</div>
  {["أساسية","عامة","فنية"].map(cat=>{
   const cc=allCompNames.filter(c=>localComps[c]?.cat===cat); if(!cc.length)return null;
   const col=CAT_COLORS[cat];
   return(
   <div key={cat} style={{marginBottom:12}}>
   <div style={{fontSize:11,color:col,fontWeight:700,marginBottom:6}}>{cat} ({cc.filter(c=>jc.includes(c)).length}/{cc.length})</div>
   <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
   {cc.map(cn=>{
  const sel=jc.includes(cn);
  return(<button key={cn} onClick={()=>toggleJobComp(jn,cn)} style={{padding:"5px 10px",borderRadius:20,border:`1px solid ${sel?col+"60":col+"20"}`,background:sel?`${col}20`:"transparent",color:sel?col:"#5B7A9E",fontSize:10,cursor:"pointer",fontWeight:sel?700:400,transition:"all 0.15s"}}>{sel?"✓ ":""}{cn}</button>);
   })}
   </div>
   </div>
   );
  })}
  </div>
  )}
  </div>
   );
   })}
  </div>
  </div>
   )}

   {showReset&&(
  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:900,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
  <div style={{background:"#FFFFFF",border:"2px solid #F97316",borderRadius:20,padding:28,maxWidth:360,textAlign:"center",direction:"rtl"}}>
   <div style={{fontSize:40,marginBottom:12}}>↺</div>
   <div style={{fontSize:15,fontWeight:900,color:"#15385C",marginBottom:8}}>إعادة الضبط الافتراضي</div>
   <div style={{fontSize:12,color:"#5B7A9E",marginBottom:20,lineHeight:1.7}}>سيتم إلغاء جميع التعديلات والرجوع للبيانات الأصلية. لا يمكن التراجع.</div>
   <div style={{display:"flex",gap:10}}>
   <button onClick={()=>setShowReset(false)} style={{flex:1,padding:"10px",borderRadius:10,border:"1px solid #C7DBF0",background:"transparent",color:"#5B7A9E",cursor:"pointer"}}>إلغاء</button>
   <button onClick={()=>{onReset();setShowReset(false);}} style={{flex:2,padding:"10px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#EA580C,#F97316)",color:"#fff",fontWeight:700,cursor:"pointer"}}>↺ إعادة الضبط</button>
   </div>
  </div>
  </div>
   )}
  </div>
  );
}

function ResultsReadingSection({ targetUser, currentUser, readings, onSave, resultsApproved = false }) {
  if (!currentUser || !targetUser) return null;
  const empReadings = (readings||{})[targetUser.id] || [];
  const alreadyRead = empReadings.find(r => r.readerId === currentUser.id);

  const markAsRead = async () => {
  if (alreadyRead) return;
  const newEntry = {
   readerId:   currentUser.id,
   readerName: currentUser.name,
   readerRole: currentUser.role,
   partyKey:   currentUser.role === "supervisor" ? "supervisor"
  : currentUser.role === "stage_mgr"  ? "stage_mgr"
  : currentUser.role === "branch_mgr" ? "branch_mgr"
  : "self",
   readAt: new Date().toISOString(),
  };
  const updated = { ...(readings||{}), [targetUser.id]: [...empReadings, newEntry] };
  await onSave(updated);
  };

  const partyLabel = { self:"التقييم الذاتي", supervisor:"المتابع الفني", stage_mgr:"المدير المباشر", branch_mgr:"مدير الفرع", peer:"الزميل" };
  const partyColor = { self:"#10B981", supervisor:"#3B82F6", stage_mgr:"#F97316", branch_mgr:"#EF4444", peer:"#8B5CF6" };
  const canRead = ["supervisor","stage_mgr","employee"].includes(currentUser.role);

  return (
  <div style={{marginTop:16,background:"#F4F9FE",border:"1px solid #B3D0EA30",borderRadius:14,padding:16}}>
   <div style={{fontSize:13,color:"#2E7FB8",fontWeight:800,marginBottom:12}}>👁️ قراءة النتائج</div>
   {empReadings.length > 0 ? (
  <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:12}}>
  {empReadings.map((r,i) => (
   <div key={i} style={{display:"flex",alignItems:"center",gap:10,background:"#FFFFFF",borderRadius:8,padding:"8px 12px",border:`1px solid ${(partyColor[r.partyKey]||"#334155")}25`}}>
   <div style={{width:8,height:8,borderRadius:"50%",background:partyColor[r.partyKey]||"#334155",flexShrink:0}}/>
   <div style={{flex:1}}>
  <span style={{fontSize:12,color:"#1E293B",fontWeight:700}}>{r.readerName}</span>
  <span style={{fontSize:10,color:partyColor[r.partyKey]||"#5B7A9E",marginRight:8}}>({partyLabel[r.partyKey]||r.partyKey})</span>
   </div>
   <span style={{fontSize:10,color:"#5B7A9E",fontFamily:MONO}}>
  {new Date(r.readAt).toLocaleDateString("ar-SA")} {new Date(r.readAt).toLocaleTimeString("ar-SA",{hour:"2-digit",minute:"2-digit"})}
   </span>
   <span>✅</span>
   </div>
  ))}
  </div>
   ) : (
  <div style={{fontSize:11,color:"#5B7A9E",marginBottom:12,padding:"8px 12px",background:"#FFFFFF",borderRadius:8}}>
  لم يتم تسجيل أي قراءة للنتائج بعد
  </div>
   )}
   {!resultsApproved ? (
  <div style={{fontSize:11,color:"#94A3B8",background:"#F1F5F9",border:"1px solid #E2E8F0",borderRadius:10,padding:"10px 14px",textAlign:"center",fontWeight:600}}>
  🔒 تُتاح قراءة النتائج بعد اكتمال التقييمات واعتماد نتائج المرحلة
  </div>
   ) : canRead && (
  alreadyRead ? (
  <div style={{display:"flex",alignItems:"center",gap:10,background:"#10B98112",border:"1px solid #10B98130",borderRadius:10,padding:"10px 16px"}}>
   <span style={{fontSize:20}}>✅</span>
   <div>
   <div style={{fontSize:12,color:"#10B981",fontWeight:700}}>تمت قراءة النتائج</div>
   <div style={{fontSize:10,color:"#5B7A9E"}}>سجَّلتَ القراءة بتاريخ {new Date(alreadyRead.readAt).toLocaleDateString("ar-SA")}</div>
   </div>
  </div>
  ) : (
  <button onClick={markAsRead}
   style={{width:"100%",padding:"11px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#1D5A8A,#2E7FB8)",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
   <span style={{fontSize:16}}>👁️</span> تسجيل قراءة النتائج مع الموظف
  </button>
  )
   )}
  </div>
  );
}

function Card360({ targetUser, empEval, onSaveIdp, idpData, onClose, readings, onSaveReadings, currentUser, hidePrint, allEvals, allUsers, impactData = {}, approvals = {} }) {
  const [tab,setTab] = useState("scores");
  // إصلاح: نعرض فقط أطراف التقييم الفعلية لدور هذا الموظف (لا كل الأطراف)
  const roleParties = partiesForRole(targetUser);
  const cardParties = EVAL_PARTIES.filter(p=>roleParties.includes(p.key));
  const [selSources,setSelSources] = useState(idpData?.selSources||{});
  const [goals,setGoals] = useState(idpData?.goals||{});
  const [openComp,setOpenComp] = useState(null);
  const [idpPlan,setIdpPlan] = useState(idpData?.plan||[]);
  const newIdpRow = () => ({id:Date.now().toString()+Math.random().toString(36).slice(2,6),needSource:"",trainMethod:"",programName:"",provider:"",url:"",cost:"",hours:"",targetDate:"",evalMethod:""});
  const addIdpRow = () => setIdpPlan(p=>[...p,newIdpRow()]);
  const updateIdpRow = (id,field,val) => setIdpPlan(p=>p.map(r=>r.id===id?{...r,[field]:val}:r));
  const deleteIdpRow = (id) => setIdpPlan(p=>p.filter(r=>r.id!==id));

  const comps = getActiveJobs()[targetUser.job]||[];

  const branchItemAvg = useMemo(()=>{
  if (!allEvals || !allUsers) return {};
  const branchPeers = allUsers.filter(u => u.branch===targetUser.branch && u.role==="employee");
  const res = {};
  comps.forEach(c=>{
   const items = getActiveComps()[c]?.items||[];
   res[c] = {};
   items.forEach((_,idx)=>{
  let sum=0, cnt=0;
  branchPeers.forEach(peer=>{
  const pe = allEvals[peer.id];
  if (!pe) return;
  let pSum=0, pCnt=0;
  EVAL_PARTIES.forEach(party=>{
   const cat = getCat(c);
   if (!PARTY_CATS[party.key].includes(cat)) return;
   const s = pe[party.key]?.[c]?.[idx];
   if (s>0){ pSum+=s; pCnt++; }
  });
  if (pCnt>0){ sum += pSum/pCnt; cnt++; }
  });
  if (cnt>0) res[c][idx] = { avg: sum/cnt, count: cnt };
   });
  });
  return res;
  },[allEvals, allUsers, comps, targetUser.branch]);

  const weightedScores = useMemo(()=>{
  const res = {};
  comps.forEach(c=>{ res[c] = calcWeightedComp(c, empEval, targetUser); });
  return res;
  },[comps,empEval]);

  const partyStatus = cardParties.map(p=>{
  const allowedCats = PARTY_CATS[p.key]||[];
  const myComps = comps.filter(c=>allowedCats.includes(getCat(c)));
  const totalItems = myComps.reduce((s,c)=>(getActiveComps()[c]?.items?.length||0)+s,0);
  const scoredItems = myComps.reduce((s,c)=>{
   const items = getActiveComps()[c]?.items||[];
   return s+items.filter((_,i)=>(empEval?.[p.key]?.[c]?.[i]||0)>0).length;
  },0);
  return { ...p, totalItems, scoredItems, done: scoredItems>0 };
  });

  const prioritized = comps
  .map(c=>({ c, ws: weightedScores[c] }))
  .filter(x=>x.ws!==null)
  .map(x=>({ c:x.c, score:x.ws.score, gap:5-x.ws.score }))
  .filter(x=>x.gap>=0.5)
  .sort((a,b)=>b.gap-a.gap);

  const isBook = s => s.startsWith("كتاب");
  const toggleSrc = (comp,src) => setSelSources(p=>{ const cur=p[comp]||[]; return {...p,[comp]:cur.includes(src)?cur.filter(s=>s!==src):[...cur,src]}; });

  const empScore = useMemo(()=>calcEmployeeScore(empEval,comps,targetUser),[empEval,comps,targetUser]);

  return (
  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:12}}>
   <div style={{background:"#FFFFFF",border:"1px solid #B3D0EA",borderRadius:20,width:"100%",maxWidth:840,maxHeight:"95vh",overflowY:"auto",padding:24}}>
  {/* رأس */}
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
  <div>
   <div style={{fontWeight:900,fontSize:17,color:"#15385C"}}>{targetUser.name}</div>
   <div style={{fontSize:11,color:"#5B7A9E",marginTop:2}}>{targetUser.job}{targetUser.branch?` • ${targetUser.branch}`:""}{targetUser.nationalId?<span style={{marginRight:8}}>🪪 {targetUser.nationalId}</span>:""}</div>
  </div>
  <div style={{display:"flex",gap:8,alignItems:"center"}}>
   {!hidePrint&&currentUser?.id!==targetUser?.id&&<PrintButton title={`بطاقة ${targetUser.name}`} branch={targetUser.branch}/>}
   <button onClick={onClose} style={{background:"none",border:"none",color:"#5B7A9E",fontSize:22,cursor:"pointer"}}>✕</button>
  </div>
  </div>

  {/* حالة الأطراف */}
  <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8,marginBottom:16}}>
  {partyStatus.map(p=>(
   <div key={p.key} style={{background:p.done?`${p.color}10`:"#F4F9FE",border:`1px solid ${p.done?p.color+"40":"#DDE9F5"}`,borderRadius:10,padding:"10px 14px"}}>
   <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
  <span style={{fontSize:12,fontWeight:700}}>{p.icon} {p.label}</span>
  {p.done&&<span style={{fontSize:10,color:p.color}}>✓ {p.scoredItems}/{p.totalItems}</span>}
   </div>
   <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:4}}>
  {p.cats.map(cat=>(
  <span key={cat} style={{fontSize:9,padding:"1px 7px",borderRadius:20,background:`${CAT_COLORS[cat]}15`,color:CAT_COLORS[cat],border:`1px solid ${CAT_COLORS[cat]}25`}}>
  {cat} {PARTY_CAT_WEIGHTS[p.key][cat]}%
  </span>
  ))}
   </div>
   {!p.done&&<div style={{fontSize:10,color:"#1E293B",marginTop:4}}>⏳ لم يكتمل</div>}
   </div>
  ))}
  </div>

  {/* درجات الأطراف + الدرجة الكلية (كنسب مئوية حسب الوزن) */}
  <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
  {cardParties.map(p=>{
   const ps=empScore?.partyScores?.[p.key]; const lv=ps?getLevel(ps.avg):null;
   const pct = ps? (ps.avg/5)*ps.weight : null;
   return(
   <div key={p.key} style={{flex:1,minWidth:100,background:"#F4F9FE",border:`1px solid ${p.color}25`,borderRadius:10,padding:"8px 10px",textAlign:"center"}}>
  <div style={{fontSize:10,color:p.color,fontWeight:700,marginBottom:3}}>{p.icon} {p.label}</div>
  {ps?<>
  <div style={{fontSize:16,fontWeight:900,color:lv.color,fontFamily:MONO}}>{pct.toFixed(1)}<span style={{fontSize:10}}>%</span></div>
  <div style={{fontSize:9,color:"#5B7A9E"}}>من {ps.weight}%</div>
  </>:<div style={{fontSize:10,color:"#1E293B",marginTop:6}}>⏳</div>}
   </div>
   );
  })}
  {empScore&&(()=>{const lv=getLevel(empScore.score); const totalPct=(empScore.score/5)*100; return(
   <div style={{flex:1,minWidth:100,background:"#F4F9FE",border:`2px solid ${lv.color}50`,borderRadius:10,padding:"8px 10px",textAlign:"center"}}>
   <div style={{fontSize:10,color:"#2E7FB8",fontWeight:700,marginBottom:3}}>🏆 الكلية</div>
   <div style={{fontSize:18,fontWeight:900,color:lv.color,fontFamily:MONO}}>{totalPct.toFixed(1)}<span style={{fontSize:11}}>%</span></div>
   <div style={{fontSize:9,color:lv.color,fontWeight:700}}>{lv.label}</div>
   </div>
  );})()}
  </div>

  {/* ب-4: عرض الجولتين ومتوسطهما عند وجود تقييم ثانٍ */}
  {hasRound2(empEval)&&(()=>{
   const s1 = scoreOfRound(empEval, targetUser);
   const s2 = scoreOfRound(empEval.__r2, targetUser);
   const favg = finalTwoRoundScore(empEval, targetUser);
   const box = (label,val,col)=>(
   <div style={{flex:1,background:"#fff",border:`1px solid ${col}30`,borderRadius:10,padding:"8px 10px",textAlign:"center"}}>
   <div style={{fontSize:10,color:col,fontWeight:700,marginBottom:2}}>{label}</div>
   <div style={{fontSize:16,fontWeight:900,color:col,fontFamily:MONO}}>{val!=null?((val/5)*100).toFixed(1):"—"}<span style={{fontSize:9}}>%</span></div>
   </div>
   );
   return (
   <div style={{background:"#F59E0B0D",border:"1px solid #F59E0B30",borderRadius:12,padding:12,marginBottom:12}}>
   <div style={{fontSize:11,fontWeight:800,color:"#D97706",marginBottom:8}}>🔁 نتائج التقييمين — الدرجة النهائية = متوسطهما</div>
   <div style={{display:"flex",gap:8}}>
   {box("التقييم الأول",s1,"#3B82F6")}
   {box("التقييم الثاني",s2,"#8B5CF6")}
   {box("🏆 النهائي (المتوسط)",favg,"#10B981")}
   </div>
   </div>
   );
  })()}
  {/* الشهادة الاحترافية جزء من خطة التطوّر — تُعرض هناك لا في بطاقة التقييم (تفادياً للخلط) */}

  {/* تبويبات — الموظف يجد المصادر والخطة في تبويب "خطة التطور المهني" بلوحته */}
  <div style={{display:"flex",gap:4,marginBottom:14,borderBottom:"1px solid #DDE9F5",paddingBottom:8}}>
  {[{k:"scores",l:"📊 تفصيل النتائج"},{k:"summary",l:"📈 ترتيب الجدارات"},{k:"witnesses",l:"📎 الشواهد"}].map(t=>(
   <button key={t.k} onClick={()=>setTab(t.k)} style={{padding:"6px 14px",borderRadius:8,border:"none",background:tab===t.k?"#3B82F620":"transparent",color:tab===t.k?"#3B82F6":"#5B7A9E",fontSize:12,fontWeight:600,cursor:"pointer",borderBottom:tab===t.k?"2px solid #3B82F6":"2px solid transparent"}}>{t.l}</button>
  ))}
  </div>

  {/* تفصيل النتائج */}
  {tab==="scores"&&(
  <div>
   {["أساسية","عامة","فنية"].map(cat=>{
   const catComps = comps.filter(c=>getCat(c)===cat);
   if (!catComps.length) return null;
   const col = CAT_COLORS[cat];
   return (
  <div key={cat} style={{marginBottom:14}}>
  <div style={{padding:"7px 14px",background:`${col}12`,borderRadius:"10px 10px 0 0",border:`1px solid ${col}25`,fontSize:12,color:col,fontWeight:800,display:"flex",justifyContent:"space-between"}}>
  <span>● الجدارات {cat==="أساسية"?"الأساسية":cat==="عامة"?"العامة/الإدارية/القيادية":"الفنية"}</span>
  <span style={{fontSize:10,fontWeight:400,color:`${col}99`}}>
  {EVAL_PARTIES.filter(p=>PARTY_CAT_WEIGHTS[p.key][cat]>0).map(p=>`${p.label} ${PARTY_CAT_WEIGHTS[p.key][cat]}%`).join(" • ")}
  </span>
  </div>
  {catComps.map(c=>{
  const ws = weightedScores[c];
  const isOpen = openComp===c;
  const items = getActiveComps()[c]?.items||[];
  return (
  <div key={c} style={{background:"#F4F9FE",border:`1px solid ${col}12`,borderTop:"none",overflow:"hidden"}}>
   <div onClick={()=>setOpenComp(isOpen?null:c)} style={{padding:"10px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:10}}>
   <div style={{flex:1}}>
   <span style={{fontWeight:700,fontSize:12,color:"#334155"}}>{c}</span>
   <span style={{fontSize:10,color:"#5B7A9E",marginRight:8}}>({items.length} بنود)</span>
   </div>
   {ws!==null ? (
   <div style={{display:"flex",alignItems:"center",gap:8}}>
   <div style={{width:60,height:4,background:"#DDE9F5",borderRadius:2,overflow:"hidden"}}><div style={{width:`${(ws.score/5)*100}%`,height:"100%",background:getLevel(ws.score).color,borderRadius:2}}/></div>
   <span style={{fontSize:12,fontWeight:900,color:getLevel(ws.score).color,fontFamily:MONO,minWidth:30}}>{ws.score.toFixed(2)}</span>
   <span style={{fontSize:10,color:getLevel(ws.score).color,minWidth:50}}>{getLevel(ws.score).label}</span>
   </div>
   ):<span style={{fontSize:11,color:"#1E293B"}}>لم يُقيَّم</span>}
   <span style={{color:"#5B7A9E",fontSize:11}}>{isOpen?"▲":"▼"}</span>
   </div>
   {isOpen&&(
   <div style={{padding:"0 14px 14px",borderTop:`1px solid ${col}10`}}>
   <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
   {EVAL_PARTIES.filter(p=>PARTY_CATS[p.key].includes(cat)).map(p=>{
  const ps = calcCompScore(c, empEval?.[p.key]?.[c]);
  return ps!==null?(
  <div key={p.key} style={{background:`${p.color}12`,borderRadius:7,padding:"4px 10px",display:"flex",gap:5,alignItems:"center"}}>
  <span style={{fontSize:10,color:p.color}}>{p.icon} {p.label}:</span>
  <span style={{fontSize:11,fontWeight:700,color:p.color,fontFamily:MONO}}>{ps.toFixed(2)}</span>
  <span style={{fontSize:9,color:"#5B7A9E"}}>({PARTY_CAT_WEIGHTS[p.key][cat]}%)</span>
  </div>
  ):null;
   })}
   </div>
   {items.map((item,idx)=>{
   const bAvg = branchItemAvg[c]?.[idx];
   return(
   <div key={idx} style={{background:"#FFFFFF",borderRadius:7,padding:"8px 12px",marginBottom:4}}>
  <div style={{fontSize:11,color:"#5B7A9E",marginBottom:5}}>{idx+1}. {item}</div>
  <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
  {EVAL_PARTIES.filter(p=>PARTY_CATS[p.key].includes(cat)).map(p=>{
  const s = empEval?.[p.key]?.[c]?.[idx]||0;
  return s>0?(
  <div key={p.key} style={{display:"flex",alignItems:"center",gap:4,background:`${p.color}10`,borderRadius:5,padding:"2px 8px"}}>
  <span style={{fontSize:9,color:p.color}}>{p.label}:</span>
  <span style={{fontSize:11,fontWeight:700,color:SCORE_COLORS[s],fontFamily:MONO}}>{s}</span>
  <span style={{fontSize:9,color:SCORE_COLORS[s]}}>{SCORE_LABELS[s]}</span>
  </div>
  ):null;
  })}
  {bAvg&&(
  <div title={`متوسط ${bAvg.count} من موظفي الفرع لهذا البند`} style={{display:"flex",alignItems:"center",gap:4,background:"#2E7FB812",border:"1px dashed #2E7FB840",borderRadius:5,padding:"2px 8px",marginRight:"auto"}}>
  <span style={{fontSize:9,color:"#2E7FB8"}}>🏫 متوسط الفرع:</span>
  <span style={{fontSize:11,fontWeight:700,color:"#2E7FB8",fontFamily:MONO}}>{bAvg.avg.toFixed(2)}</span>
  </div>
  )}
  </div>
   </div>
   );
   })}
   </div>
   )}
  </div>
  );
  })}
  </div>
   );
   })}

  {/* تفصيل تقييمات زملاء التخصص — للمديرين فقط (اسم كل مُقيّم ودرجته) */}
  {["stage_mgr","branch_mgr","admin"].includes(currentUser.role)&&(()=>{
   const raters = empEval?.peerRaters||{};
   const rids = Object.keys(raters);
   if(!rids.length) return null;
   const basics = (getActiveJobs()[targetUser.job]||[]).filter(c=>getCat(c)==="أساسية");
   const raterAvg = (rid)=>{
  const vals=basics.map(c=>calcCompScore(c,raters[rid]?.[c])).filter(s=>s!==null);
  return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
   };
   const rows = rids.map(rid=>{
  const u=(allUsers||[]).find(x=>x.id===rid);
  return {rid, name:u?u.name:"مُقيّم", job:u?.job||"", avg:raterAvg(rid)};
   }).filter(r=>r.avg!=null).sort((a,b)=>b.avg-a.avg);
   if(!rows.length) return null;
   const groupAvg = rows.reduce((a,b)=>a+b.avg,0)/rows.length;
   return(
  <div style={{background:"#FEF2F8",border:"1px solid #EC489930",borderRadius:14,padding:16,marginTop:12}}>
  <div style={{fontSize:13,fontWeight:900,color:"#BE185D",marginBottom:4}}>🔒 تفصيل تقييمات زملاء التخصص <span style={{fontSize:10,fontWeight:400,color:"#8CA3BD"}}>(للإدارة فقط — لا يظهر للموظف أو الزملاء)</span></div>
  <div style={{fontSize:11,color:"#5B7A9E",marginBottom:10}}>عدد المُقيّمين: {rows.length} • متوسط المجموعة: <span style={{fontWeight:800,color:"#BE185D",fontFamily:MONO}}>{((groupAvg/5)*100).toFixed(1)}%</span></div>
  {rows.map(r=>{
   const dev=r.avg-groupAvg;
   const devColor = Math.abs(dev)<0.3?"#8CA3BD":dev>0?"#10B981":"#EF4444";
   return(
   <div key={r.rid} style={{display:"flex",alignItems:"center",gap:10,background:"#fff",border:"1px solid #F5D0E5",borderRadius:9,padding:"8px 12px",marginBottom:5}}>
  <div style={{flex:1,minWidth:0}}><span style={{fontSize:12,fontWeight:700,color:"#15385C"}}>{r.name}</span><span style={{fontSize:10,color:"#8CA3BD"}}> • {r.job}</span></div>
  <span style={{fontSize:13,fontWeight:900,color:getLevel(r.avg).color,fontFamily:MONO}}>{((r.avg/5)*100).toFixed(0)}%</span>
  <span style={{fontSize:9,color:devColor,minWidth:52,textAlign:"left"}}>{dev>0?"▲ أعلى":dev<0?"▼ أدنى":"= متوسط"} {Math.abs((dev/5)*100).toFixed(0)}%</span>
   </div>
   );
  })}
  </div>
   );
  })()}
  {/* عدد المُقيّمين من الزملاء — يراه الموظف والزميل (دون كشف الهوية) */}
  {!["stage_mgr","branch_mgr","admin"].includes(currentUser.role)&&(()=>{
   const raters = empEval?.peerRaters||{};
   const cnt = Object.keys(raters).filter(rid=>{
  const basics=(getActiveJobs()[targetUser.job]||[]).filter(c=>getCat(c)==="أساسية");
  return basics.some(c=>Object.values(raters[rid]?.[c]||{}).some(v=>v>0));
   }).length;
   if(!cnt) return null;
   return(
  <div style={{background:"#8B5CF60D",border:"1px solid #8B5CF625",borderRadius:12,padding:"12px 16px",marginTop:12,display:"flex",alignItems:"center",gap:10}}>
  <span style={{fontSize:20}}>🤝</span>
  <div style={{fontSize:12,color:"#5B7A9E",lineHeight:1.6}}>
   قيّمك <span style={{fontWeight:900,color:"#8B5CF6",fontFamily:MONO}}>{cnt}</span> من زملاء التخصص.
   {cnt<PEER_MIN_RATERS?<span style={{color:"#F59E0B"}}> بانتظار تقييم زملاء إضافيين لإظهار الدرجة (تحتاج {PEER_MIN_RATERS} على الأقل).</span>:<span style={{color:"#10B981"}}> تظهر درجتك كمتوسط دون كشف هوية المُقيّمين.</span>}
  </div>
  </div>
   );
  })()}
  {/* عدد المُقيّمين من المرؤوسين والمستفيدين (لكل الأطراف، دون هوية) */}
  {["subordinate","beneficiary"].map(party=>{
   const raters = empEval?.[party+"Raters"]||{};
   const cnt = Object.keys(raters).filter(rid=>Object.values(raters[rid]||{}).some(cs=>Object.values(cs).some(v=>v>0))).length;
   if(!cnt) return null;
   const isSub = party==="subordinate";
   const col = isSub?"#8B5CF6":"#0891B2";
   return(
  <div key={party} style={{background:`${col}0D`,border:`1px solid ${col}25`,borderRadius:12,padding:"12px 16px",marginTop:12,display:"flex",alignItems:"center",gap:10}}>
  <span style={{fontSize:20}}>{isSub?"⬆️":"🎯"}</span>
  <div style={{fontSize:12,color:"#5B7A9E",lineHeight:1.6}}>
   قيّمك <span style={{fontWeight:900,color:col,fontFamily:MONO}}>{cnt}</span> من {isSub?"المرؤوسين":"المستفيدين من الخدمة"}.
   {cnt<PEER_MIN_RATERS?<span style={{color:"#F59E0B"}}> تحتاج {PEER_MIN_RATERS} مُقيّمين على الأقل لإظهار الدرجة.</span>:<span style={{color:"#10B981"}}> تظهر كمتوسط دون كشف الهوية.</span>}
  </div>
  </div>
   );
  })}
  {/* تفصيل تقييمات المرؤوسين/المستفيدين — لمدير النظام فقط (بالهوية) */}
  {currentUser.role==="admin"&&["subordinate","beneficiary"].map(party=>{
   const raters = empEval?.[party+"Raters"]||{};
   const rids = Object.keys(raters).filter(rid=>Object.values(raters[rid]||{}).some(cs=>Object.values(cs).some(v=>v>0)));
   if(!rids.length) return null;
   const isSub = party==="subordinate";
   const col = isSub?"#8B5CF6":"#0891B2";
   return(
  <div key={party+"_detail"} style={{background:`${col}08`,border:`1px dashed ${col}40`,borderRadius:12,padding:"12px 16px",marginTop:10}}>
   <div style={{fontSize:12,fontWeight:900,color:col,marginBottom:8}}>🔒 تفصيل {isSub?"تقييمات المرؤوسين":"تقييمات المستفيدين"} <span style={{fontSize:10,fontWeight:400,color:"#8CA3BD"}}>(لمدير النظام فقط)</span></div>
   {rids.map(rid=>{
   const rater = (allUsers||[]).find(u=>u.id===rid);
   const allV = []; Object.values(raters[rid]||{}).forEach(cs=>Object.values(cs).forEach(v=>{if(v>0)allV.push(v);}));
   const avg = allV.length?(allV.reduce((a,b)=>a+b,0)/allV.length):0;
   return(
   <div key={rid} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#fff",borderRadius:8,padding:"6px 12px",marginBottom:4}}>
   <span style={{fontSize:11,color:"#334155"}}>{rater?.name||rid}</span>
   <span style={{fontSize:11,fontWeight:700,color:col,fontFamily:MONO}}>{avg.toFixed(2)}</span>
   </div>
   );
   })}
  </div>
   );
  })}
  </div>
  )}

  {/* ترتيب الجدارات */}
  {tab==="summary"&&(
  <div>
   {comps.filter(c=>weightedScores[c]!==null).length===0?(
   <div style={{textAlign:"center",padding:40,color:"#5B7A9E"}}>لم يكتمل أي تقييم بعد</div>
   ):["أساسية","عامة","فنية"].map(cat=>{
   const catComps = comps.filter(c=>getCat(c)===cat&&weightedScores[c]!==null).sort((a,b)=>weightedScores[a].score-weightedScores[b].score);
   if (!catComps.length) return null;
   const col = CAT_COLORS[cat];
   return (
  <div key={cat} style={{marginBottom:16}}>
  <div style={{fontSize:12,color:col,fontWeight:700,marginBottom:8,padding:"5px 0",borderBottom:`1px solid ${col}20`}}>● {cat==="أساسية"?"الأساسية":cat==="عامة"?"العامة/الإدارية/القيادية":"الفنية"}</div>
  {catComps.map(c=>{
  const s=weightedScores[c].score; const lv=getLevel(s);
  return (
  <div key={c} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:"#F4F9FE",borderRadius:8,marginBottom:5,border:`1px solid ${col}10`}}>
   <div style={{flex:1,fontSize:12,color:"#94A3B8"}}>{c}</div>
   <div style={{width:100,height:4,background:"#DDE9F5",borderRadius:2,overflow:"hidden"}}>
   <div style={{width:`${(s/5)*100}%`,height:"100%",background:lv.color,borderRadius:2}}/>
   </div>
   <div style={{width:36,fontSize:12,fontWeight:700,color:lv.color,fontFamily:MONO}}>{s.toFixed(2)}</div>
   <div style={{width:60,fontSize:10,color:lv.color}}>{lv.label}</div>
  </div>
  );
  })}
  </div>
   );
   })}
  </div>
  )}

  {/* خطة التطوير */}
  {tab==="idp"&&(
  <div>
   {prioritized.length===0?(
   <div style={{textAlign:"center",padding:40,color:"#5B7A9E"}}>لا توجد فجوات حرجة أو لم يكتمل التقييم</div>
   ):prioritized.map(({c,score,gap},idx)=>{
   const lv = getLevel(score); const srcs = IDP_MATRIX[c]||[];
   const courses = srcs.filter(s=>!isBook(s)); const books = srcs.filter(s=>isBook(s));
   const chosen = selSources[c]||[]; const isOpen = openComp===`idp_${c}`;
   return (
  <div key={c} style={{background:"#F4F9FE",border:`1px solid ${idx<3?"#EF444425":"#DDE9F5"}`,borderRadius:12,marginBottom:10,overflow:"hidden"}}>
  <div onClick={()=>setOpenComp(isOpen?null:`idp_${c}`)} style={{padding:"12px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:10}}>
  <div style={{width:28,height:28,borderRadius:8,background:idx<3?"#EF444415":"#DDE9F5",color:idx<3?"#EF4444":"#5B7A9E",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:12,flexShrink:0}}>{idx+1}</div>
  <div style={{flex:1}}>
  <div style={{fontWeight:700,fontSize:13,color:"#1E293B"}}>{c}</div>
  <div style={{display:"flex",gap:8,marginTop:3,alignItems:"center"}}>
   <span style={{fontSize:10,background:`${CAT_COLORS[getCat(c)]}15`,padding:"1px 7px",borderRadius:20,color:CAT_COLORS[getCat(c)]}}>{getCat(c)}</span>
   <span style={{fontSize:11,color:lv.color}}>{score.toFixed(2)}/5</span>
   <span style={{fontSize:11,color:"#EF4444"}}>فجوة: {gap.toFixed(2)}</span>
  </div>
  </div>
  {chosen.length>0&&<span style={{background:"#10B98115",color:"#10B981",fontSize:10,padding:"2px 8px",borderRadius:20}}>✓ {chosen.length}</span>}
  <span style={{color:"#5B7A9E"}}>{isOpen?"▲":"▼"}</span>
  </div>
  {isOpen&&onSaveIdp&&(
  <div style={{padding:"0 16px 16px",borderTop:"1px solid #DDE9F5"}}>
  <div style={{marginBottom:10}}>
   <label style={{display:"block",fontSize:11,color:"#5B7A9E",marginBottom:4,fontWeight:700}}>🎯 هدف التطوير</label>
   <input value={goals[c]||""} onChange={e=>setGoals(p=>({...p,[c]:e.target.value}))} placeholder="مثال: رفع المستوى من 2 إلى 4 خلال هذا الفصل..."
   style={{width:"100%",padding:"8px 12px",background:"#FFFFFF",border:"1px solid #C7DBF0",borderRadius:8,color:"#1E293B",fontSize:12,boxSizing:"border-box"}}/>
  </div>
  {[{src:courses,label:"🎓 الدورات",color:"#10B981"},{src:books,label:"📖 الكتب",color:"#F59E0B"}].filter(x=>x.src.length>0).map(({src,label,color})=>(
   <div key={label} style={{marginBottom:8}}>
   <div style={{fontSize:11,color,fontWeight:700,marginBottom:5}}>{label}</div>
   {src.map((s,i)=>{const picked=chosen.includes(s);return(
   <div key={i} onClick={()=>toggleSrc(c,s)} style={{padding:"7px 10px",borderRadius:7,border:`1px solid ${picked?color:"#DDE9F5"}`,background:picked?`${color}10`:"#FFFFFF",cursor:"pointer",display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
   <div style={{width:14,height:14,borderRadius:4,border:`2px solid ${picked?color:"#1E293B"}`,background:picked?color:"transparent",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"#fff",flexShrink:0}}>{picked?"✓":""}</div>
   <span style={{fontSize:11,color:picked?"#15385C":"#5B7A9E"}}>{s}</span>
   </div>
   );})}
   </div>
  ))}
  {srcs.length===0&&<div style={{fontSize:11,color:"#1E293B",textAlign:"center",padding:12}}>ستُضاف مصادر هذه الجدارة قريباً</div>}
  </div>
  )}
  </div>
   );
   })}
   {onSaveIdp&&prioritized.length>0&&(
   <button onClick={()=>onSaveIdp({selSources,goals,plan:idpPlan})} style={{width:"100%",padding:"11px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#10B981,#059669)",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",marginTop:8}}>💾 حفظ الخطة التطويرية</button>
   )}
  </div>
  )}
  {/* خطة التطوير الفردي */}
  {tab==="idpplan"&&(
  <div>
   <div style={{background:"#3B82F60D",border:"1px solid #B3D0EA",borderRadius:12,padding:"12px 16px",marginBottom:14,fontSize:12,color:"#94A3B8",lineHeight:1.7}}>
   📝 خطة تطوير مهني مفصّلة — تعاونية بين الموظف والمتابع الفني/المدير المباشر.
   </div>
   {idpPlan.length===0?(
   <div style={{textAlign:"center",padding:36,color:"#5B7A9E"}}>
  <div style={{fontSize:32,marginBottom:10}}>📋</div>
  <div style={{marginBottom:14}}>لا توجد بنود بعد</div>
  {onSaveIdp&&<button onClick={addIdpRow} style={{padding:"9px 20px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#1D5A8A,#2E7FB8)",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer"}}>➕ إضافة أول بند</button>}
   </div>
   ):idpPlan.map((row,idx)=>{
   const F=(field)=>row[field]||"";
   const setF=(field,val)=>updateIdpRow(row.id,field,val);
   const iS={width:"100%",padding:"8px 10px",background:"#F4F9FE",border:"1.5px solid #A9C9E8",borderRadius:8,color:"#15385C",fontSize:12,boxSizing:"border-box",outline:"none"};
   const lS={display:"block",fontSize:10,color:"#5B7A9E",marginBottom:4,fontWeight:700};
   return(
  <div key={row.id} style={{background:"#F4F9FE",border:"1px solid #B3D0EA40",borderRadius:14,padding:16,marginBottom:12}}>
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
  <span style={{fontSize:13,color:"#2E7FB8",fontWeight:700}}>بند {idx+1}</span>
  {onSaveIdp&&<button onClick={()=>deleteIdpRow(row.id)} style={{background:"none",border:"1px solid #EF444430",borderRadius:8,color:"#EF4444",fontSize:12,cursor:"pointer",padding:"4px 10px"}}>🗑 حذف</button>}
  </div>
  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
  <div>
  <label style={lS}>📌 مصدر الاحتياج</label>
  <select value={F("needSource")} disabled={!onSaveIdp} onChange={e=>setF("needSource",e.target.value)} style={{...iS,color:F("needSource")?"#15385C":"#5B7A9E"}}>
   <option value="">— اختر —</option>
   {IDP_NEED_SOURCES.map(o=><option key={o} value={o}>{o}</option>)}
  </select>
  </div>
  <div>
  <label style={lS}>🎓 أسلوب التدريب</label>
  <select value={F("trainMethod")} disabled={!onSaveIdp} onChange={e=>setF("trainMethod",e.target.value)} style={{...iS,color:F("trainMethod")?"#15385C":"#5B7A9E"}}>
   <option value="">— اختر —</option>
   {IDP_TRAIN_METHODS.map(o=><option key={o} value={o}>{o}</option>)}
  </select>
  </div>
  <div style={{gridColumn:"1 / -1"}}>
  <label style={lS}>📚 اسم البرنامج أو الكتاب</label>
  <input value={F("programName")} readOnly={!onSaveIdp} onChange={e=>setF("programName",e.target.value)} placeholder="مثال: دورة طرق التدريس..." style={iS}/>
  </div>
  <div>
  <label style={lS}>🏛️ الجهة</label>
  <input value={F("provider")} readOnly={!onSaveIdp} onChange={e=>setF("provider",e.target.value)} style={iS}/>
  </div>
  <div>
  <label style={lS}>🔗 رابط</label>
  <div style={{display:"flex",gap:6}}>
   <input value={F("url")} readOnly={!onSaveIdp} onChange={e=>setF("url",e.target.value)} placeholder="https://..." style={{...iS,flex:1,direction:"ltr"}}/>
   {isValidUrl(F("url"))&&<a href={F("url")} target="_blank" rel="noopener noreferrer" style={{padding:"8px 10px",borderRadius:8,background:"#3B82F615",color:"#3B82F6",fontSize:12,textDecoration:"none"}}>🔗</a>}
  </div>
  </div>
  <div>
  <label style={lS}>💰 التكلفة</label>
  <input value={F("cost")} readOnly={!onSaveIdp} onChange={e=>setF("cost",e.target.value)} placeholder="ريال / مجاني" style={iS}/>
  </div>
  <div>
  <label style={lS}>⏱️ الساعات</label>
  <input value={F("hours")} readOnly={!onSaveIdp} onChange={e=>setF("hours",e.target.value)} style={iS}/>
  </div>
  <div>
  <label style={lS}>📅 تاريخ التنفيذ</label>
  <input type="date" value={F("targetDate")} readOnly={!onSaveIdp} onChange={e=>setF("targetDate",e.target.value)} style={iS}/>
  <div style={{fontSize:9,color:"#8CA3BD",marginTop:3,lineHeight:1.5}}>💡 يُفضّل أن تنتهي فترة التنفيذ في الفصل الدراسي الأول</div>
  </div>
  <div style={{gridColumn:"1 / -1"}}>
  <label style={lS}>✅ أسلوب التقييم</label>
  <select value={F("evalMethod")} disabled={!onSaveIdp} onChange={e=>setF("evalMethod",e.target.value)} style={{...iS,color:F("evalMethod")?"#15385C":"#5B7A9E"}}>
   <option value="">— اختر —</option>
   {IDP_EVAL_METHODS.map(o=><option key={o} value={o}>{o}</option>)}
  </select>
  </div>
  {impactData&&<ImpactMeasure row={row} impact={impactData[`${user.id}__${row.id}`]} editable={false} onSave={()=>{}}/>}
  </div>
  </div>
   );
   })}
   {onSaveIdp&&idpPlan.length>0&&(
   <div style={{display:"flex",gap:10,marginTop:8}}>
  <button onClick={addIdpRow} style={{flex:1,padding:"11px",borderRadius:12,border:"1px dashed #3B82F660",background:"#3B82F60D",color:"#3B82F6",fontWeight:700,fontSize:13,cursor:"pointer"}}>➕ إضافة بند</button>
  <button onClick={()=>onSaveIdp({selSources,goals,plan:idpPlan})} style={{flex:2,padding:"11px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#10B981,#059669)",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer"}}>💾 حفظ الخطة</button>
   </div>
   )}
   {!onSaveIdp&&idpPlan.length>0&&(
   <div style={{textAlign:"center",padding:10,fontSize:11,color:"#5B7A9E",background:"#F4F9FE",borderRadius:10}}>👁️ عرض فقط</div>
   )}
  </div>
  )}
  {/* شواهد الدرجة 5 */}
  {tab==="witnesses"&&(()=>{
  const allWitnesses = getWitnesses(empEval);
  return (
   <div>
   {allWitnesses.length===0?(
  <div style={{textAlign:"center",padding:40,color:"#5B7A9E"}}>
  <div style={{fontSize:32,marginBottom:10}}>📎</div>
  <div>لا توجد شواهد مُدرجة — تظهر عند إعطاء درجة 5 من المشرف أو مدير المرحلة</div>
  </div>
   ):allWitnesses.map((w,i)=>(
  <div key={i} style={{background:"#F4F9FE",border:"1px solid #10B98125",borderRadius:12,padding:"14px 16px",marginBottom:10}}>
  <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8,alignItems:"center"}}>
  <span style={{fontSize:14}}>📎</span>
  <span style={{fontSize:12,color:"#10B981",fontWeight:700}}>{w.comp}</span>
  <span style={{fontSize:10,padding:"1px 8px",borderRadius:20,background:`${CAT_COLORS[getCat(w.comp)]}15`,color:CAT_COLORS[getCat(w.comp)]}}>{getCat(w.comp)}</span>
  <span style={{fontSize:10,padding:"1px 8px",borderRadius:20,background:"#10B98115",color:"#10B981",border:"1px solid #10B98130"}}>⭐ ممتاز (5)</span>
  <span style={{fontSize:10,color:"#3B82F6",marginRight:"auto"}}>{w.partyLabel}</span>
  </div>
  <div style={{fontSize:11,color:"#5B7A9E",marginBottom:8,padding:"6px 10px",background:"#FFFFFF",borderRadius:6,lineHeight:1.6}}>
  البند: {w.itemText}
  </div>
  <div style={{padding:"10px 12px",background:"#10B98110",border:"1px solid #10B98130",borderRadius:8}}>
  <div style={{fontSize:10,color:"#10B981",fontWeight:700,marginBottom:4}}>الشاهد / الدليل:</div>
  <div style={{fontSize:12,color:"#1E293B",lineHeight:1.7}}>{w.witness}</div>
  </div>
  </div>
   ))}
   </div>
  );
  })()}

  {/* قراءة النتائج — لا تُتاح إلا بعد اعتماد نتائج المرحلة (بدء مرحلة القراءة) */}
  {readings && currentUser && (()=>{
   const stageKey = `${targetUser.branch}__${targetUser.stage}__eval`;
   const resultsApproved = !!(approvals && approvals[stageKey] && approvals[stageKey].approved);
   return (
  <ResultsReadingSection
   targetUser={targetUser}
   currentUser={currentUser}
   readings={readings}
   onSave={onSaveReadings}
   resultsApproved={resultsApproved}
  />
   );
  })()}
   </div>
  </div>
  );
}

// ج-1: نموذج طلب فتح حساب (لمدير الفرع/الإدارة — ضمن نطاقه فقط)
function RequestAccountForm({ user, onSubmit }) {
  // النطاق: مدير الفرع قد يدير فرعين (بنين/بنات)؛ مدير الإدارة نطاقه إدارته
  const myBranches = scopeBranches(user);
  const scopeIsDept = isDepartment(myBranches[0]);
  const scopeWord = scopeIsDept ? "الإدارة" : "الفرع";
  const [f,setF] = useState({ name:"", username:"", nationalId:"", password:"", role:"employee", roleSubtype:"", job:"", stage:"", branch: myBranches[0]||"" });
  const set = (k,v) => setF(p=>({...p,[k]:v}));
  const subtypes = ROLE_SUBTYPES[f.role] ? Object.entries(ROLE_SUBTYPES[f.role]) : [];
  // تحقّق صيغة البريد الإلكتروني (اسم المستخدم = البريد الفعلي)
  const emailOk = /^[^\s@]+@as\.edu\.sa$/i.test(f.username.trim());
  const nationalIdOk = /^\d{10}$/.test(String(f.nationalId).trim());
  // الحقول الإلزامية: الاسم، البريد (صالح)، كلمة المرور، رقم الهوية (10 أرقام)، المسمّى الوظيفي، الدور، الفرع، والمرحلة (للفروع لا الإدارات)
  const stageRequired = !scopeIsDept;
  const missing = [];
  if (!f.name.trim())     missing.push("الاسم الكامل");
  if (!f.username.trim()) missing.push("البريد الإلكتروني");
  else if (!emailOk)      missing.push("بريد بدومين @as.edu.sa (مثل name@as.edu.sa)");
  if (!f.password.trim()) missing.push("كلمة المرور المبدئية");
  if (!String(f.nationalId).trim()) missing.push("رقم الهوية");
  else if (!nationalIdOk) missing.push("رقم هوية صحيح (10 أرقام)");
  if (!f.job)             missing.push("المسمّى الوظيفي");
  if (!f.role)            missing.push("الدور");
  if (!f.branch)          missing.push(scopeWord);
  if (stageRequired && !f.stage) missing.push("المرحلة");
  const canSubmit = missing.length===0;
  const iS = {width:"100%",padding:"9px 11px",background:"#F4F9FE",border:"1px solid #DDE9F5",borderRadius:9,color:"#15385C",fontSize:12,boxSizing:"border-box"};
  const lS = {display:"block",fontSize:11,color:"#5B7A9E",marginBottom:4,fontWeight:700};
  // الأدوار المتاحة للطلب (لا مدير نظام)
  const roleOpts = Object.entries(ROLES_LIST).filter(([k])=>k!=="admin");
  // قائمة المسميات الوظيفية التي يديرها مدير النظام
  const jobOpts = Object.keys(getActiveJobs()||{});
  return (
  <div style={{background:"#FFFFFF",border:"1px solid #EC489925",borderRadius:14,padding:18}}>
   <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
   <span style={{fontSize:20}}>➕</span>
   <div>
   <div style={{fontSize:14,fontWeight:900,color:"#DB2777"}}>طلب فتح حساب جديد</div>
   <div style={{fontSize:11,color:"#5B7A9E"}}>ضمن نطاقك ({myBranches.join(" + ")||"—"}) — يعتمده مدير النظام</div>
   </div>
   </div>
   <div style={{background:"#3B82F60D",border:"1px solid #3B82F625",borderRadius:9,padding:"8px 12px",margin:"10px 0",fontSize:11,color:"#5B7A9E",lineHeight:1.7}}>
   💡 اسم المستخدم = <strong style={{color:"#3B82F6"}}>البريد الفعلي للموظف</strong>. ضع كلمة مرور مبدئية بسيطة، ويمكن للموظف تغييرها من لوحته بعد الدخول.
   </div>
   <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
   <div><label style={lS}>الاسم الكامل *</label><input value={f.name} onChange={e=>set("name",e.target.value)} style={iS}/></div>
   <div><label style={lS}>📧 البريد (اسم المستخدم) *</label><input value={f.username} onChange={e=>set("username",e.target.value)} placeholder="name@as.edu.sa" style={{...iS,border:`1px solid ${!f.username.trim()?"#DDE9F5":emailOk?"#10B98160":"#EF444460"}`}}/>
   {f.username.trim()&&!emailOk&&<div style={{fontSize:9,color:"#EF4444",marginTop:3}}>⚠️ يجب أن يكون البريد بدومين @as.edu.sa (مثال: name@as.edu.sa)</div>}</div>
   <div><label style={lS}>🪪 رقم الهوية *</label><input value={f.nationalId} onChange={e=>set("nationalId",e.target.value.replace(/\D/g,"").slice(0,10))} inputMode="numeric" placeholder="10 أرقام" style={{...iS,border:`1px solid ${!String(f.nationalId).trim()?"#DDE9F5":nationalIdOk?"#10B98160":"#EF444460"}`}}/>
   {String(f.nationalId).trim()&&!nationalIdOk&&<div style={{fontSize:9,color:"#EF4444",marginTop:3}}>⚠️ رقم الهوية يجب أن يكون 10 أرقام</div>}</div>
   <div><label style={lS}>المسمّى الوظيفي *</label>
   <select value={f.job} onChange={e=>set("job",e.target.value)} style={iS}>
   <option value="">— اختر المسمّى —</option>
   {jobOpts.map(j=><option key={j} value={j}>{j}</option>)}
   </select></div>
   <div><label style={lS}>🔑 كلمة المرور المبدئية *</label><input value={f.password} onChange={e=>set("password",e.target.value)} placeholder="مثال: 123456" style={iS}/></div>
   <div><label style={lS}>الدور *</label>
   <select value={f.role} onChange={e=>{set("role",e.target.value);set("roleSubtype","");}} style={iS}>
   {roleOpts.map(([k,v])=><option key={k} value={k}>{v}</option>)}
   </select></div>
   {subtypes.length>0&&(
   <div><label style={lS}>النوع الفرعي</label>
   <select value={f.roleSubtype} onChange={e=>set("roleSubtype",e.target.value)} style={iS}>
   <option value="">— اختر —</option>
   {subtypes.map(([k,v])=><option key={k} value={k}>{v}</option>)}
   </select></div>
   )}
    {!scopeIsDept&&<div><label style={lS}>المرحلة *</label>
    <select value={f.stage} onChange={e=>set("stage",e.target.value)} style={iS}>
    <option value="">— اختر المرحلة —</option>
    {STAGES.map(s=><option key={s} value={s}>{s}</option>)}
    </select></div>}
   <div><label style={lS}>{scopeWord} *</label>
   {myBranches.length>1
   ? <select value={f.branch} onChange={e=>set("branch",e.target.value)} style={iS}>{myBranches.map(b=><option key={b} value={b}>{b}</option>)}</select>
   : <input value={f.branch} readOnly style={{...iS,background:"#EDF4FC",color:"#8CA3BD"}}/>}
   </div>
   </div>
   {!canSubmit&&missing.length>0&&(
   <div style={{marginTop:12,background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:10,padding:"9px 12px",fontSize:11,color:"#B91C1C",lineHeight:1.7}}>
   ⚠️ لإرسال الطلب، استكمل: {missing.join("، ")}
   </div>
   )}
   <button onClick={()=>{ if(canSubmit){ onSubmit({...f}); setF({name:"",username:"",nationalId:"",password:"",role:"employee",roleSubtype:"",job:"",stage:"",branch:myBranches[0]||""}); } }}
   disabled={!canSubmit} style={{width:"100%",marginTop:14,padding:"12px",borderRadius:12,border:"none",background:canSubmit?"linear-gradient(135deg,#DB2777,#EC4899)":"#CBD5E1",color:"#fff",fontWeight:700,fontSize:13,cursor:canSubmit?"pointer":"not-allowed"}}>📨 إرسال الطلب لمدير النظام</button>
  </div>
  );
}

function BranchManagerPanel({ user, onLogout }) {
  const [tab,setTab] = useState("growth"); // growth | eval | approve
  const [evalWinData,setEvalWinData] = useState({branches:{}});
  const [users,setUsersState] = useState([]);
  const [evals,setEvalsState] = useState({});
  const [idps,setIdpsState] = useState({});
  const [approvals,setApprovals] = useState({});
  const [readings,setReadings] = useState({});
  const [locks,setLocks] = useState({});
  const [editRequests,setEditRequests] = useState({});
  const [acctRequests,setAcctRequests] = useState([]); // ج-1: طلبات فتح الحسابات
  const [impactData,setImpactData] = useState({});
  const [viewUser,setViewUser] = useState(null);
  const [viewPlanUser,setViewPlanUser] = useState(null); // عرض خطة التطور للقيادي التابع (لا بطاقة التقييم)
  const [editRow,setEditRow] = useState(null); // {emp, row}
  const [toast,setToast] = useState(null);
  const showToast = (msg,c="#10B981") => { setToast({msg,c}); setTimeout(()=>setToast(null),2500); };
  // د-7: حفظ خطة وتقييم مدير الفرع نفسه
  const saveMyIdp = async (d) => { const ni={...idps,[user.id]:d}; setIdpsState(ni); await st.set("idps_360c",ni); showToast("✓ تم حفظ خطتك"); };
  const saveMySelfEval = async (scores) => { const ne={...evals}; if(!ne[user.id])ne[user.id]={}; ne[user.id].self=scores; setEvalsState(ne); await st.set("evals_360c",ne); showToast("✓ تم حفظ تقييمك الذاتي"); };
  const approveLeaderPlan = async (targetId, approve) => {
  const cur = idps[targetId]||{};
  const ni = {...idps,[targetId]:{...cur, approved:approve, approvedBy:approve?user.name:null, approvedAt:approve?new Date().toISOString().split("T")[0]:null}};
  setIdpsState(ni); await st.set("idps_360c",ni);
  showToast(approve?"✅ اعتُمدت خطة القيادي":"↩ أُلغي الاعتماد");
  };
  // ج-1: إرسال طلب فتح حساب
  const submitAcctRequest = async (payload) => {
  const req = { ...payload, id:(typeof crypto!=="undefined"&&crypto.randomUUID?crypto.randomUUID():String(Date.now())), status:"pending", requesterId:user.id, requesterName:user.name, createdAt:new Date().toISOString().split("T")[0] };
  const nr = [req, ...acctRequests];
  setAcctRequests(nr); await st.set("acctRequests_360c",nr);
  showToast("📨 أُرسل الطلب لمدير النظام");
  };

  useEffect(()=>{
  Promise.all([st.get("users_360c"),st.get("evals_360c"),st.get("idps_360c"),st.get("approvals_360c"),st.get("readings_360c"),st.get("locks_360c"),st.get("editreq_360c"),st.get("impact_360c")]).then(([u,e,i,a,r,l,er,im])=>{
   setUsersState(u||[]); setEvalsState(e||{}); setIdpsState(i||{}); setApprovals(a||{}); setReadings(r||{}); setLocks(l||{}); setEditRequests(er||{}); setImpactData(im||{});
  });
  st.get("acctRequests_360c").then(d=>setAcctRequests(Array.isArray(d)?d:[]));
  st.get("evalwindow_360c").then(w=>setEvalWinData(w||{branches:{}}));
  st.getShared("customComps_360c").then(d=>{ if(d){ setActiveComps(d); COMPETENCIES_WITH_ITEMS=d; } });
  st.getShared("profCerts_360c").then(d=>{ if(d&&d.length){ setProfCerts(d); } });
  st.getShared("customJobs_360c").then(d=>{ if(d){ setActiveJobs(d); JOB_COMPETENCIES=d; } });
  st.getShared("customWeights_360c").then(d=>{ if(d){ setActiveWeights(d); if(d.employee||d.leader||d.specialist||d.branch_ext) applyCustomWeights(d); else applyCustomWeights({employee:d}); } });
  st.getShared("customSources_360c").then(d=>{ if(d){ setActiveSources(d); } });
  st.getShared("customSourceMap_360c").then(d=>{ if(d){ setActiveCompMap(d); } });
  setTimeout(()=>setUsersState(u=>[...u]), 300);
  },[]);

  const myBranches = scopeBranches(user);
  // متابعة مدير الفرع تشمل: الموظفين + مدراء المراحل والوكلاء التابعين لفروعه (لتقييمهم ومتابعة نتائجهم)
  const branchEmps = (users||[]).filter(u=>["employee","stage_mgr","deputy"].includes(u.role) && myBranches.includes(u.branch));
  // قيادات الفرع (مدراء المراحل والوكلاء) — يقيّمهم مدير الفرع ويعتمد خططهم، ويُعرضون منفصلين عن مجموعات المراحل
  const branchLeaders = (users||[]).filter(u=>["stage_mgr","deputy"].includes(u.role) && myBranches.includes(u.branch));
  const brStagePairs = [];
  myBranches.forEach(br=>{
  const st2 = [...new Set(branchEmps.filter(u=>u.branch===br).map(u=>u.stage).filter(Boolean))].sort();
  st2.forEach(s=>brStagePairs.push({br,stage:s}));
  });
  const multiBranch = myBranches.length>1;
  const statusColor = { "تم التنفيذ":"#10B981", "جاري التنفيذ":"#F59E0B", "لم يتم التنفيذ":"#EF4444" };

  const stageEvalKey = (br,stage)=>`${br}__${stage}__eval`;
  const isStageEvalApproved = (br,stage)=>!!(approvals[stageEvalKey(br,stage)]?.approved);
  const approveStageEval = async (br,stage) => {
  const na = {...approvals, [stageEvalKey(br,stage)]:{approved:true, by:user.name, at:new Date().toISOString().split("T")[0]}};
  setApprovals(na); await st.set("approvals_360c",na);
  showToast(`✅ اعتُمدت نتائج تقييم مرحلة ${stage} — بدأت قراءة النتائج`);
  };
  const revokeStageEval = async (br,stage) => {
  const na = {...approvals}; delete na[stageEvalKey(br,stage)];
  setApprovals(na); await st.set("approvals_360c",na);
  showToast(`↩ أُلغي اعتماد نتائج مرحلة ${stage}`,"#EF4444");
  };

  const stagePlanKey = (br,stage)=>`${br}__${stage}__plans`;
  const isStagePlanApproved = (br,stage)=>!!(approvals[stagePlanKey(br,stage)]?.approved);
  const stagePlansReady = (br,stage) => {
  const emps = branchEmps.filter(u=>u.branch===br && u.stage===stage);
  const withPlans = emps.filter(u=>idps[u.id]?.plan?.length);
  if (!withPlans.length) return false;
  return withPlans.every(u=>idps[u.id]?.approved); // كلها معتمدة فنياً
  };
  const approveStagePlans = async (br,stage) => {
  if (!stagePlansReady(br,stage)) { showToast("⚠️ لا يمكن الاعتماد: بعض الخطط لم يعتمدها المتابع الفني بعد","#F59E0B"); return; }
  const na = {...approvals, [stagePlanKey(br,stage)]:{approved:true, by:user.name, at:new Date().toISOString().split("T")[0]}};
  setApprovals(na); await st.set("approvals_360c",na);
  showToast(`✅ اعتُمدت خطط التطور لمرحلة ${stage}`);
  };

  const saveRowEdit = async (empId, rowId, patch) => {
  const cur = idps[empId]||{};
  const np = (cur.plan||[]).map(r=>r.id===rowId?{...r,...patch}:r);
  const ni = {...idps,[empId]:{...cur,plan:np}};
  setIdpsState(ni); await st.set("idps_360c",ni);
  setEditRow(null); showToast("✓ تم تعديل البند");
  };

  const decideEditRequest = async (empId, decision) => {
  const nr = {...editRequests};
  if (nr[empId]) nr[empId] = {...nr[empId], status:decision, decidedAt:new Date().toISOString().split("T")[0], decidedBy:user.name};
  setEditRequests(nr); await st.set("editreq_360c",nr);
  if (decision==="approved") {
   const ni = {...idps};
   if (ni[empId]) { ni[empId] = {...ni[empId], editUnlocked:true, editUnlockedRow:nr[empId].rowId}; setIdpsState(ni); await st.set("idps_360c",ni); }
  }
  showToast(decision==="approved"?"✓ ووفِق على التعديل":"تم رفض الطلب", decision==="approved"?"#10B981":"#EF4444");
  };

  const growthStats = useMemo(()=>{
  let plans=0,approved=0,rows=0,done=0,inprog=0,hours=0,cost=0;
  let approvedRows=0, impactMeasured=0;
  branchEmps.forEach(u=>{ const p=idps[u.id]; if(p?.plan?.length){plans++; if(p.approved)approved++;
   p.plan.forEach(r=>{rows++; if(r.status==="تم التنفيذ")done++; else if(r.status==="جاري التنفيذ")inprog++;
  const h=parseFloat(String(r.hours||"").replace(/[^\d.]/g,"")); if(!isNaN(h))hours+=h;
  const c=parseFloat(String(r.cost||"").replace(/[^\d.]/g,"")); if(!isNaN(c))cost+=c;
  // نسبة قياس الأثر: من البنود في الخطط المعتمدة، كم بنداً قِيس أثره
  if(p.approved){ approvedRows++;
   const im=impactData[`${u.id}__${r.id}`];
   if(im&&im.scores&&Object.keys(im.scores).length>0) impactMeasured++;
  } });
  }});
  return {plans,approved,rows,execPct:rows?Math.round((done+inprog*0.5)/rows*100):0,hours,cost,
   impactPct: approvedRows?Math.round((impactMeasured/approvedRows)*100):0, impactMeasured, approvedRows};
  },[branchEmps,idps,impactData]);

  const pendingReqs = Object.entries(editRequests).filter(([id,r])=>{const e=branchEmps.find(u=>u.id===id);return e&&r.status==="pending";});
  const newPlans = branchEmps.filter(u=>idps[u.id]?.needsBranchApproval && idps[u.id]?.approved);
  const approveNewPlan = async (empId) => {
  const cur = idps[empId]||{};
  const ni = {...idps,[empId]:{...cur,needsBranchApproval:false,branchApprovedAt:new Date().toISOString().split("T")[0]}};
  setIdpsState(ni); await st.set("idps_360c",ni);
  showToast("✅ اعتُمدت خطة الموظف الجديد");
  };

  return (
  <div style={{minHeight:"100vh",background:APP_BG,fontFamily:"'El Messiri',sans-serif",direction:"rtl",color:"#1E293B"}}>
   {toast&&<div style={{position:"fixed",top:18,left:"50%",transform:"translateX(-50%)",background:toast.c,color:"#fff",padding:"11px 26px",borderRadius:30,fontWeight:700,fontSize:13,zIndex:9999,boxShadow:`0 8px 28px ${toast.c}55`}}>{toast.msg}</div>}

   <header style={{background:"rgba(255,255,255,0.82)",backdropFilter:"blur(14px)",borderBottom:"1px solid #C7DBF0",padding:"0 20px",position:"sticky",top:0,zIndex:100,boxShadow:"0 4px 18px rgba(46,127,184,0.08)"}}>
  <div style={{maxWidth:1050,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",height:54}}>
  <div style={{display:"flex",alignItems:"center",gap:10}}>
   <LogoImg style={{height:32}} size={15}/>
   <div><div style={{fontWeight:900,fontSize:15,color:"#15385C",letterSpacing:"-0.3px"}}>إدارة {myBranches.length>1?"الفروع":"الفرع"}</div><div style={{fontSize:10,color:"#5B7A9E"}}>{user.name} • 🏛️ {myBranches.join(" • ")||"—"}</div></div>
  </div>
  <div style={{display:"flex",gap:6}}>
   <PrintButton title={`تقرير فرع ${user.branch}`} branch={user.branch}/>
   <ChangePasswordButton userId={user.id} currentPassword={user.password}/>
   <RefreshButton/><button onClick={onLogout} style={{padding:"5px 12px",borderRadius:20,border:"1px solid #EF444430",background:"#EF444410",color:"#EF4444",fontSize:11,cursor:"pointer",marginRight:6}}>خروج</button>
  </div>
  </div>
   </header>

   <main className="print-area" style={{maxWidth:1050,margin:"0 auto",padding:"20px 16px"}}>
  <div style={{display:"flex",gap:8,marginBottom:18,flexWrap:"wrap"}}>
  {[{k:"growth",l:"👥 متابعة التطور المهني",c:"#10B981"},{k:"eval",l:"📋 متابعة تقييم الأداء",c:"#3B82F6"},{k:"approve",l:"✅ اعتماد الخطط والتعديلات",c:"#8B5CF6"},{k:"accounts",l:"➕ طلبات الحسابات",c:"#EC4899"},{k:"mine",l:"🎯 خطتي وتقييمي",c:"#F59E0B"}].map(t=>(
   <button key={t.k} onClick={()=>setTab(t.k)} style={{flex:"1 1 auto",minWidth:160,padding:"13px 18px",borderRadius:24,border:"none",background:tab===t.k?`linear-gradient(135deg,${t.c},${t.c}cc)`:"#fff",color:tab===t.k?"#fff":"#5B7A9E",fontSize:13,fontWeight:800,cursor:"pointer",boxShadow:tab===t.k?`0 8px 22px ${t.c}45`:"0 2px 10px rgba(46,127,184,0.08)",position:"relative"}}>
   {t.l}{t.k==="approve"&&(pendingReqs.length+newPlans.length)>0&&<span style={{position:"absolute",top:-6,left:-6,background:"#EF4444",color:"#fff",fontSize:10,fontWeight:900,borderRadius:12,minWidth:18,height:18,display:"inline-flex",alignItems:"center",justifyContent:"center",padding:"0 5px"}}>{pendingReqs.length+newPlans.length}</span>}
   </button>
  ))}
  </div>

  {/* ═══ التبويب 1: متابعة التطور المهني ═══ */}
  {tab==="growth"&&(
  <div>
   <LeaderPlanApprovals user={user} users={users} idps={idps} impactData={impactData} readings={readings}
   onApprovePlan={approveLeaderPlan} onOpenCard={(t)=>setViewPlanUser(t)}/>
   {/* قيادات الفرع: متابعة خطط التطور لمدراء المراحل والوكلاء (منفصلين عن الموظفين) */}
   {branchLeaders.length>0&&(
   <div style={{background:"#8B5CF608",border:"1px solid #8B5CF625",borderRadius:20,marginTop:14,marginBottom:8,padding:18}}>
   <div style={{fontSize:15,fontWeight:900,color:"#7C3AED",marginBottom:4}}>🏛️ قيادات الفرع — متابعة التطور المهني</div>
   <div style={{fontSize:11,color:"#8CA3BD",marginBottom:12}}>مدراء المراحل والوكلاء ({branchLeaders.length}) — للاطّلاع على خططهم.</div>
   {branchLeaders.map(u=>{
   const plan=idps[u.id]||{}; const rows=plan.plan||[]; const ap=plan.approved;
   return(
   <details key={u.id} style={{background:"#fff",border:`1px solid ${ap?"#10B98125":"#E3EEF9"}`,borderRadius:14,marginBottom:8,overflow:"hidden"}}>
   <summary style={{padding:"11px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:12,listStyle:"none"}}>
   <div style={{width:32,height:32,borderRadius:9,background:ap?"#10B98115":"#F4F9FE",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>{ap?"✅":"🎯"}</div>
   <div style={{flex:1,minWidth:0}}><div style={{fontWeight:700,fontSize:12,color:"#15385C"}}>{u.name}</div><div style={{fontSize:10,color:"#8CA3BD"}}>{ROLES_LIST[u.role]}{u.stage?` • ${u.stage}`:""} • {rows.length} بند</div></div>
   <span style={{fontSize:10,color:ap?"#10B981":"#F59E0B",background:ap?"#10B98115":"#F59E0B15",padding:"3px 10px",borderRadius:20,fontWeight:700}}>{ap?"معتمدة":plan.isFinal?"بانتظار الاعتماد":"مسودّة"}</span>
   <button onClick={(e)=>{e.preventDefault();setViewPlanUser(u);}} style={{padding:"5px 12px",borderRadius:8,border:"1px solid #8B5CF640",background:"#8B5CF610",color:"#7C3AED",fontSize:11,cursor:"pointer",fontWeight:700}}>👁️ عرض الخطة</button>
   </summary>
   <div style={{padding:"0 14px 12px",borderTop:"1px solid #EEF4FB"}}>
   {rows.length===0?<div style={{textAlign:"center",padding:14,color:"#8CA3BD",fontSize:12}}>لا خطة بعد</div>:rows.map((r,i)=>{
   const sc=statusColor[r.status]||"#8CA3BD";
   return(<div key={r.id} style={{background:"#F4F9FE",border:`1px solid ${sc}25`,borderRadius:10,padding:"9px 12px",marginTop:8}}>
   <div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
   <div style={{flex:1,minWidth:0,fontSize:12,color:"#15385C",fontWeight:700}}>{r.cat?`[${r.cat}] `:""}{r.programName||r.comp||`بند ${i+1}`}</div>
   <span style={{fontSize:10,color:sc,background:`${sc}15`,padding:"3px 10px",borderRadius:20,fontWeight:700}}>{r.status||"لم يتم"}</span>
   </div></div>);
   })}
   </div>
   </details>
   );
   })}
   </div>
   )}
   <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap",marginTop:14}}>
   {[{l:"👥 الموظفون",v:branchEmps.length,c:"#2E7FB8"},{l:"📋 خطط معتمدة فنياً",v:`${growthStats.approved}/${growthStats.plans}`,c:"#10B981"},{l:"⏱️ الساعات",v:growthStats.hours%1===0?growthStats.hours:growthStats.hours.toFixed(1),c:"#0891B2"},{l:"💰 التكلفة",v:growthStats.cost>0?growthStats.cost.toLocaleString("en-US"):"0",c:"#D97706"},{l:"📊 نسبة التنفيذ",v:`${growthStats.execPct}%`,c:"#059669"},{l:"📏 قياس الأثر",v:`${growthStats.impactPct}%`,c:"#8B5CF6"}].map((card,i)=>(
  <div key={i} style={{flex:1,minWidth:110,background:BRAND.cardBg,border:`1px solid ${BRAND.cardBorder}`,borderRadius:20,padding:"16px 18px",boxShadow:"0 8px 26px rgba(46,127,184,0.10)"}}>
  <div style={{fontSize:11,color:card.c,fontWeight:700,marginBottom:4}}>{card.l}</div>
  <div style={{fontSize:20,fontWeight:900,color:"#15385C",fontFamily:MONO}}>{card.v}</div>
  </div>
   ))}
   </div>
   <div style={{background:"#10B9810D",border:"1px solid #10B98130",borderRadius:12,padding:"12px 16px",marginBottom:14,fontSize:12,color:"#5B7A9E",lineHeight:1.7}}>👁️ متابعة خطط التطور لموظفي مراحل فرعك (تخطيط • تنفيذ • قياس الأثر) — للاطّلاع فقط.</div>
   {brStagePairs.map(({br,stage})=>{
   const emps = branchEmps.filter(u=>u.branch===br && u.stage===stage);
   return(
  <div key={br+stage} style={{marginBottom:16}}>
  <div style={{fontSize:13,fontWeight:900,color:"#2E7FB8",padding:"8px 4px",borderBottom:"2px solid #C7DBF0",marginBottom:8}}>{multiBranch?`🏛️ ${br} — `:""}📚 {stage} ({emps.length})</div>
  {emps.map(u=>{
  const plan=idps[u.id]||{}; const rows=plan.plan||[]; const ap=plan.approved;
  const pct=rows.length?Math.round((rows.filter(r=>r.status==="تم التنفيذ").length+rows.filter(r=>r.status==="جاري التنفيذ").length*0.5)/rows.length*100):0;
  return(
  <details key={u.id} style={{background:BRAND.cardBg,border:`1px solid ${ap?"#10B98125":BRAND.cardBorder}`,borderRadius:18,marginBottom:8,overflow:"hidden",boxShadow:"0 6px 20px rgba(46,127,184,0.08)"}}>
   <summary style={{padding:"12px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:12,listStyle:"none"}}>
   <div style={{width:34,height:34,borderRadius:9,background:ap?"#10B98115":"#F4F9FE",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15}}>{ap?"✅":"🎯"}</div>
   <div style={{flex:1,minWidth:0}}><div style={{fontWeight:700,fontSize:12,color:"#15385C"}}>{u.name}</div><div style={{fontSize:10,color:"#8CA3BD"}}>{u.job} • {rows.length} بند{ap?` • تنفيذ ${pct}%`:""}</div></div>
   <span style={{fontSize:10,color:ap?"#10B981":"#F59E0B",background:ap?"#10B98115":"#F59E0B15",padding:"3px 10px",borderRadius:20,fontWeight:700}}>{ap?"معتمدة فنياً":"غير معتمدة"}</span>
   </summary>
   <div style={{padding:"0 16px 14px",borderTop:"1px solid #DDE9F5"}}>
   {rows.length===0?<div style={{textAlign:"center",padding:16,color:"#8CA3BD",fontSize:12}}>لا خطة بعد</div>:rows.map((r,i)=>{
   const sc=statusColor[r.status]||"#8CA3BD";
   return(<div key={r.id} style={{background:"#F4F9FE",border:`1px solid ${sc}25`,borderRadius:10,padding:"10px 12px",marginTop:8}}>
   <div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
  <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,color:"#15385C",fontWeight:700}}>{r.cat?`[${r.cat}] `:""}{r.programName||r.comp||`بند ${i+1}`}</div><div style={{fontSize:10,color:"#8CA3BD",marginTop:2}}>{r.provider||"—"}{r.hours?` • ${r.hours}س`:""}{r.cost?` • ${r.cost}`:""}</div></div>
  <span style={{fontSize:10,color:sc,background:`${sc}15`,padding:"3px 10px",borderRadius:20,fontWeight:700,height:"fit-content"}}>{r.status||"لم يتم"}</span>
   </div>
   {r.status==="تم التنفيذ"&&r.evalMethod&&<ImpactMeasure row={r} impact={impactData[`${u.id}__${r.id}`]} editable={false} onSave={()=>{}}/>}
   </div>);
   })}
   </div>
  </details>
  );
  })}
  </div>
   );
   })}
  </div>
  )}

  {/* ═══ التبويب 2: متابعة تقييم الأداء ═══ */}
  {tab==="eval"&&(
  <div>
   <details style={{background:BRAND.cardBg,border:`1px solid ${BRAND.cardBorder}`,borderRadius:20,marginBottom:14,overflow:"hidden",boxShadow:"0 8px 26px rgba(46,127,184,0.10)"}}>
   <summary style={{padding:"14px 16px",cursor:"pointer",fontSize:13,fontWeight:800,color:"#2E7FB8",listStyle:"none"}}>📑 تحليل تقييمات موظفي الفرع (اضغط للعرض)</summary>
   <div style={{padding:"0 16px 16px"}}><AggregateReport users={branchEmps} evals={evals} currentUser={user} restrictBranch/></div>
   </details>
   <div style={{background:"#3B82F60D",border:"1px solid #3B82F630",borderRadius:12,padding:"12px 16px",marginBottom:14,fontSize:12,color:"#5B7A9E",lineHeight:1.7}}>✅ اعتمد نتائج تقييم كل مرحلة على حدة. بعد الاعتماد تبدأ مرحلة قراءة النتائج بين الموظف والمتابع الفني ومدير المرحلة.</div>
   {brStagePairs.map(({br,stage})=>{
   const emps = branchEmps.filter(u=>u.branch===br && u.stage===stage);
   const apEval = isStageEvalApproved(br,stage);
   const info = approvals[stageEvalKey(br,stage)];
   // شرط الاكتمال: كل الموظفين لديهم تقييم مكتمل (كل أطرافهم المطلوبة مسجّلة → avg موجود)
   const evalReady = emps.length>0 && emps.every(u=>{ const es=getEmpFullStats(u,evals[u.id]||{}); return es?.avg!=null; });
   return(
  <div key={br+stage} style={{background:BRAND.cardBg,border:`1px solid ${apEval?"#10B98130":BRAND.cardBorder}`,borderRadius:20,marginBottom:12,padding:18,boxShadow:"0 8px 26px rgba(46,127,184,0.10)"}}>
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10,marginBottom:emps.length?12:0}}>
  <div><div style={{fontSize:17,fontWeight:900,color:"#15385C",letterSpacing:"-0.3px"}}>{multiBranch?`🏛️ ${br} — `:""}📚 {stage}</div><div style={{fontSize:11,color:"#8CA3BD",display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}><span>{emps.length} موظف{apEval&&info?` • اعتمدها ${info.by} • ${info.at}`:""}</span>{(()=>{ const ws=branchWindowStatus(evalWinData,br); return <span style={{color:ws.color,background:`${ws.color}12`,padding:"1px 8px",borderRadius:10,fontWeight:700}}>{ws.icon} التقييم {ws.label}</span>; })()}</div></div>
  <button onClick={()=>{ if(apEval){revokeStageEval(br,stage);} else if(evalReady){approveStageEval(br,stage);} }} disabled={!apEval&&!evalReady} title={!apEval&&!evalReady?"يلزم اكتمال تقييم جميع الموظفين أولاً":""} style={{padding:"9px 20px",borderRadius:22,border:`2px solid ${apEval?"#10B98160":(evalReady?"#F59E0B60":"#DDE9F5")}`,background:apEval?"#10B98118":(evalReady?"#F59E0B18":"#F1F5F9"),color:apEval?"#10B981":(evalReady?"#F59E0B":"#94A3B8"),fontSize:12,cursor:(apEval||evalReady)?"pointer":"not-allowed",fontWeight:800}}>{apEval?"✅ معتمدة — قراءة النتائج مفتوحة":(evalReady?"🏅 اعتماد نتائج المرحلة":"⏳ بانتظار اكتمال التقييم")}</button>
  </div>
  {emps.length>0&&<div style={{marginBottom:10}}><EvalStatusBoard emps={emps} evals={evals} locks={locks}/></div>}
  {emps.map(u=>{
  const es=getEmpFullStats(u,evals[u.id]||{}); const pct=es?.avg!=null?(es.avg/5)*100:null; const lv=es?.avg!=null?getLevel(es.avg):null;
  return(<div key={u.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:"#F4F9FE",borderRadius:9,marginBottom:5}}>
  <div style={{flex:1,minWidth:0}}><span style={{fontSize:12,fontWeight:700,color:"#15385C"}}>{u.name}</span><span style={{fontSize:10,color:"#8CA3BD"}}> • {u.job}</span></div>
  {pct!=null?<span style={{fontSize:12,fontWeight:900,color:lv.color,fontFamily:MONO}}>{pct.toFixed(1)}% <span style={{fontSize:9}}>{lv.label}</span></span>:<span style={{fontSize:10,color:"#8CA3BD"}}>لا تقييم</span>}
  <button onClick={()=>setViewUser(u)} style={{padding:"4px 10px",borderRadius:7,border:"1px solid #C7DBF0",background:"#fff",color:"#5B7A9E",fontSize:10,cursor:"pointer"}}>عرض</button>
  </div>);
  })}
  </div>
   );
   })}
   {/* قيادات الفرع: مدراء المراحل والوكلاء (يقيّمهم مدير الفرع، منفصلين عن مجموعات المراحل) */}
   {branchLeaders.length>0&&(
   <div style={{background:BRAND.cardBg,border:`1px solid ${BRAND.cardBorder}`,borderRadius:20,marginBottom:12,padding:18,boxShadow:"0 8px 26px rgba(46,127,184,0.10)"}}>
   <div style={{fontSize:17,fontWeight:900,color:"#15385C",marginBottom:12}}>🏛️ قيادات الفرع (مدراء المراحل والوكلاء)</div>
   {branchLeaders.map(u=>{
   const es=getEmpFullStats(u,evals[u.id]||{}); const pct=es?.avg!=null?(es.avg/5)*100:null; const lv=es?.avg!=null?getLevel(es.avg):null;
   return(<div key={u.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:"#F4F9FE",borderRadius:9,marginBottom:5}}>
   <div style={{flex:1,minWidth:0}}><span style={{fontSize:12,fontWeight:700,color:"#15385C"}}>{u.name}</span><span style={{fontSize:10,color:"#8CA3BD"}}> • {ROLES_LIST[u.role]}{u.stage?` • ${u.stage}`:""}</span></div>
   {pct!=null?<span style={{fontSize:12,fontWeight:900,color:lv.color,fontFamily:MONO}}>{pct.toFixed(1)}% <span style={{fontSize:9}}>{lv.label}</span></span>:<span style={{fontSize:10,color:"#8CA3BD"}}>لا تقييم</span>}
   <button onClick={()=>setViewUser(u)} style={{padding:"4px 10px",borderRadius:7,border:"1px solid #C7DBF0",background:"#fff",color:"#5B7A9E",fontSize:10,cursor:"pointer"}}>عرض</button>
   </div>);
   })}
   </div>
   )}
  </div>
  )}

  {/* ═══ التبويب 3: اعتماد الخطط والتعديلات ═══ */}
  {tab==="approve"&&(
  <div>
   {newPlans.length>0&&(
   <div style={{background:"#10B9810A",border:"1px solid #10B98135",borderRadius:14,padding:16,marginBottom:16}}>
  <div style={{fontSize:14,fontWeight:900,color:"#059669",marginBottom:4}}>🆕 خطط موظفين جُدد بانتظار الاعتماد ({newPlans.length})</div>
  <div style={{fontSize:11,color:"#5B7A9E",marginBottom:12}}>موظفون أُضيفوا بعد اعتماد خطط مراحلهم، خطّط لهم المتابع الفني واعتمدها — اعتمدها فردياً لتكتمل.</div>
  {newPlans.map(u=>{
  const rows=idps[u.id]?.plan||[];
  return(
  <div key={u.id} style={{background:"#fff",border:"1px solid #A7F3D0",borderRadius:12,padding:"12px 14px",marginBottom:8}}>
  <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap",alignItems:"center",marginBottom:8}}>
   <div style={{flex:1,minWidth:180}}>
   <div style={{fontSize:13,fontWeight:800,color:"#15385C"}}>{u.name} <span style={{fontSize:10,color:"#8CA3BD"}}>• {u.job} • {u.stage}</span></div>
   <div style={{fontSize:10,color:"#8CA3BD",marginTop:2}}>{rows.length} بند • اعتمده المتابع: {idps[u.id]?.approvedBy||"—"}</div>
   </div>
   <button onClick={()=>approveNewPlan(u.id)} style={{padding:"8px 18px",borderRadius:20,border:"none",background:"linear-gradient(135deg,#059669,#10B981)",color:"#fff",fontSize:12,fontWeight:800,cursor:"pointer"}}>✅ اعتماد الخطة</button>
  </div>
  <div style={{display:"flex",flexDirection:"column",gap:5}}>
   {rows.map((r,i)=>(
   <div key={r.id} style={{background:"#F4F9FE",borderRadius:8,padding:"7px 11px",display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap",alignItems:"center"}}>
   <div style={{flex:1,minWidth:0}}><span style={{fontSize:11,color:"#15385C",fontWeight:700}}>{r.cat?`[${r.cat}] `:""}{r.programName||r.comp||`بند ${i+1}`}</span><span style={{fontSize:10,color:"#8CA3BD"}}>{r.provider?` • ${r.provider}`:""}{r.cost?` • 💰${r.cost}`:""}</span></div>
   <button onClick={()=>setEditRow({emp:u,row:r})} style={{padding:"3px 9px",borderRadius:7,border:"1px solid #8B5CF640",background:"#8B5CF610",color:"#8B5CF6",fontSize:10,cursor:"pointer",fontWeight:700}}>✏️ تعديل</button>
   </div>
   ))}
  </div>
  </div>
  );
  })}
   </div>
   )}
   {pendingReqs.length>0&&(
   <div style={{background:"#F59E0B0A",border:"1px solid #F59E0B35",borderRadius:14,padding:16,marginBottom:16}}>
  <div style={{fontSize:14,fontWeight:900,color:"#D97706",marginBottom:12}}>✏️ طلبات تعديل من المتابعين الفنيين ({pendingReqs.length})</div>
  {pendingReqs.map(([empId,r])=>{const e=branchEmps.find(u=>u.id===empId);return(
  <div key={empId} style={{background:"#fff",border:"1px solid #F5D9A8",borderRadius:12,padding:"12px 14px",marginBottom:8}}>
  <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
  <div style={{flex:1,minWidth:200}}>
   <div style={{fontSize:13,fontWeight:700,color:"#15385C"}}>{e?.name} <span style={{fontSize:10,color:"#8CA3BD"}}>• {e?.job} • {e?.stage}</span></div>
   <div style={{fontSize:11,color:"#5B7A9E",marginTop:4}}>مقدّم الطلب: <span style={{color:"#2E7FB8"}}>{r.requestedBy}</span> • {r.at}</div>
   <div style={{marginTop:8,fontSize:12,background:"#F4F9FE",borderRadius:8,padding:"8px 12px"}}>
   <div>🔄 الحالي: <span style={{color:"#EF4444"}}>{r.oldName||"—"}</span></div>
   <div style={{marginTop:4}}>✨ البديل: <span style={{color:"#10B981",fontWeight:700}}>{r.altName}</span></div>
   {r.reason&&<div style={{marginTop:4,color:"#8CA3BD"}}>📝 {r.reason}</div>}
   </div>
  </div>
  <div style={{display:"flex",gap:6,flexShrink:0,alignItems:"flex-start"}}>
   <button onClick={()=>decideEditRequest(empId,"approved")} style={{padding:"7px 14px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#059669,#10B981)",color:"#fff",fontSize:11,cursor:"pointer",fontWeight:700}}>✅ موافقة</button>
   <button onClick={()=>decideEditRequest(empId,"rejected")} style={{padding:"7px 14px",borderRadius:8,border:"1px solid #EF444440",background:"#EF444410",color:"#EF4444",fontSize:11,cursor:"pointer",fontWeight:700}}>✕ رفض</button>
  </div>
  </div>
  </div>
  );})}
   </div>
   )}
   <div style={{background:"#8B5CF60D",border:"1px solid #8B5CF630",borderRadius:12,padding:"12px 16px",marginBottom:14,fontSize:12,color:"#5B7A9E",lineHeight:1.7}}>بداية العام: اعتمد إجمالي خطط كل مرحلة بعد اعتماد كل المتابعين الفنيين لها. يمكنك تعديل أي بند تراه غير مناسب أو مرتفع التكلفة (تغيير مباشر).</div>
   {brStagePairs.map(({br,stage})=>{
   const emps = branchEmps.filter(u=>u.branch===br && u.stage===stage);
   const empsWithPlans = emps.filter(u=>idps[u.id]?.plan?.length);
   const ready = stagePlansReady(br,stage);
   const apPlan = isStagePlanApproved(br,stage);
   const info = approvals[stagePlanKey(br,stage)];
   return(
  <div key={br+stage} style={{background:BRAND.cardBg,border:`1px solid ${apPlan?"#10B98130":BRAND.cardBorder}`,borderRadius:20,marginBottom:12,padding:18,boxShadow:"0 8px 26px rgba(46,127,184,0.10)"}}>
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10,marginBottom:12}}>
  <div><div style={{fontSize:17,fontWeight:900,color:"#15385C",letterSpacing:"-0.3px"}}>{multiBranch?`🏛️ ${br} — `:""}📚 {stage}</div><div style={{fontSize:11,color:"#8CA3BD"}}>{empsWithPlans.length} خطة{apPlan&&info?` • اعتمدها ${info.by} • ${info.at}`:ready?" • جاهزة للاعتماد":" • بانتظار اعتماد المتابعين الفنيين"}</div></div>
  {apPlan
  ? <span style={{padding:"9px 20px",borderRadius:22,background:"#10B98118",border:"2px solid #10B98160",color:"#10B981",fontSize:12,fontWeight:800}}>✅ الخطط معتمدة</span>
  : <button onClick={()=>approveStagePlans(br,stage)} disabled={!ready} style={{padding:"9px 20px",borderRadius:22,border:"none",background:ready?"linear-gradient(135deg,#6D28D9,#8B5CF6)":"#DDE9F5",color:ready?"#fff":"#8CA3BD",fontSize:12,cursor:ready?"pointer":"not-allowed",fontWeight:800}}>{ready?"✅ اعتماد خطط المرحلة":"⏳ بانتظار المتابعين"}</button>}
  </div>
  {empsWithPlans.map(u=>{
  const rows=idps[u.id]?.plan||[]; const ap=idps[u.id]?.approved;
  return(
  <details key={u.id} style={{background:"#F4F9FE",borderRadius:10,marginBottom:6,overflow:"hidden"}}>
   <summary style={{padding:"10px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:10,listStyle:"none"}}>
   <span style={{fontSize:12,fontWeight:700,color:"#15385C",flex:1}}>{u.name} <span style={{fontSize:10,color:"#8CA3BD"}}>• {rows.length} بند</span></span>
   <span style={{fontSize:9,color:ap?"#10B981":"#F59E0B",background:ap?"#10B98115":"#F59E0B15",padding:"2px 8px",borderRadius:10,fontWeight:700}}>{ap?"معتمدة فنياً":"غير معتمدة فنياً"}</span>
   </summary>
   <div style={{padding:"0 14px 12px"}}>
   {rows.map((r,i)=>(
   <div key={r.id} style={{background:"#fff",border:"1px solid #DDE9F5",borderRadius:8,padding:"8px 12px",marginTop:6,display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap",alignItems:"center"}}>
   <div style={{flex:1,minWidth:0}}><div style={{fontSize:11,color:"#15385C",fontWeight:700}}>{r.cat?`[${r.cat}] `:""}{r.programName||r.comp||`بند ${i+1}`}</div><div style={{fontSize:10,color:"#8CA3BD"}}>{r.provider||"—"}{r.cost?` • 💰 ${r.cost}`:""}{r.hours?` • ${r.hours}س`:""}</div></div>
   <button onClick={()=>setEditRow({emp:u,row:r})} style={{padding:"4px 10px",borderRadius:7,border:"1px solid #8B5CF640",background:"#8B5CF610",color:"#8B5CF6",fontSize:10,cursor:"pointer",fontWeight:700}}>✏️ تعديل</button>
   </div>
   ))}
   </div>
  </details>
  );
  })}
  {empsWithPlans.length===0&&<div style={{textAlign:"center",padding:16,color:"#8CA3BD",fontSize:12}}>لا خطط في هذه المرحلة بعد</div>}
  </div>
   );
   })}
  </div>
  )}

  {/* ═══ ج-1: طلبات الحسابات ═══ */}
  {tab==="accounts"&&(
  <div>
   <RequestAccountForm user={user} onSubmit={submitAcctRequest}/>
   <div style={{marginTop:16}}>
   <div style={{fontSize:13,fontWeight:800,color:"#5B7A9E",marginBottom:8}}>📋 طلباتي ({acctRequests.filter(r=>r.requesterId===user.id).length})</div>
   {acctRequests.filter(r=>r.requesterId===user.id).length===0?(
   <div style={{textAlign:"center",padding:28,color:"#8CA3BD",background:"#fff",borderRadius:12,fontSize:12}}>لا طلبات بعد.</div>
   ):acctRequests.filter(r=>r.requesterId===user.id).map(r=>{
   const col = r.status==="approved"?"#10B981":r.status==="rejected"?"#EF4444":"#F59E0B";
   const lbl = r.status==="approved"?"✅ معتمد":r.status==="rejected"?"❌ مرفوض":"⏳ قيد الاعتماد";
   return (
   <div key={r.id} style={{background:"#fff",border:`1px solid ${col}30`,borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
   <div style={{flex:1}}>
   <div style={{fontWeight:700,fontSize:12,color:"#1E293B"}}>{r.name}</div>
   <div style={{fontSize:10,color:"#5B7A9E"}}>{r.username} • {ROLES_LIST[r.role]}{r.job?` • ${r.job}`:""}</div>
   {r.status==="rejected"&&r.rejectNote&&<div style={{fontSize:10,color:"#EF4444",marginTop:2}}>سبب الرفض: {r.rejectNote}</div>}
   </div>
   <span style={{fontSize:11,fontWeight:800,color:col,background:`${col}15`,padding:"4px 12px",borderRadius:20}}>{lbl}</span>
   </div>
   );
   })}
   </div>
  </div>
  )}

  {/* ═══ خطتي وتقييمي (د-7) ═══ */}
  {tab==="mine"&&(
  <MyPlanAndEval user={user} idps={idps} evals={evals} impactData={impactData} readings={readings} locks={locks} setLocks={setLocks} evalWinData={evalWinData}
   onSaveIdp={saveMyIdp} onSaveSelfEval={saveMySelfEval} onSaveReadings={async d=>{setReadings(d);await st.set("readings_360c",d);}} showToast={showToast}/>
  )}
   </main>

   {viewUser&&<Card360 targetUser={viewUser} empEval={evals[viewUser.id]||{}} idpData={idps[viewUser.id]} readings={readings} onSaveReadings={async d=>{setReadings(d);await st.set("readings_360c",d);}} currentUser={user} allEvals={evals} allUsers={users} approvals={approvals} onClose={()=>setViewUser(null)}/>}

   {viewPlanUser&&(
   <div onClick={()=>setViewPlanUser(null)} style={{position:"fixed",inset:0,background:"rgba(15,56,92,0.55)",zIndex:1000,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"30px 16px",overflowY:"auto"}}>
   <div onClick={e=>e.stopPropagation()} style={{background:"#F7FBFF",borderRadius:20,maxWidth:900,width:"100%",padding:"20px",boxShadow:"0 24px 60px rgba(0,0,0,0.3)"}}>
   <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
   <div><div style={{fontSize:16,fontWeight:900,color:"#15385C"}}>📋 خطة التطوّر المهني — {viewPlanUser.name}</div><div style={{fontSize:11,color:"#8CA3BD"}}>{ROLES_LIST[viewPlanUser.role]}{viewPlanUser.stage?` • ${viewPlanUser.stage}`:""}</div></div>
   <button onClick={()=>setViewPlanUser(null)} style={{background:"none",border:"none",fontSize:22,color:"#5B7A9E",cursor:"pointer"}}>✕</button>
   </div>
   <EmployeeGrowthPlan user={viewPlanUser} empEval={evals[viewPlanUser.id]||{}} idpData={idps[viewPlanUser.id]} onSave={()=>{}} viewerRole="viewer" impactData={impactData} minHours={getEvalModel(viewPlanUser)==="leader"?15:12}/>
   </div>
   </div>
   )}

   {editRow&&<BranchRowEditModal emp={editRow.emp} row={editRow.row} onSave={(patch)=>saveRowEdit(editRow.emp.id,editRow.row.id,patch)} onClose={()=>setEditRow(null)}/>}
  </div>
  );
}

function BranchRowEditModal({ emp, row, onSave, onClose }) {
  const [mode,setMode] = useState("edit"); // edit | library | manual
  const [programName,setProgramName] = useState(row.programName||"");
  const [provider,setProvider] = useState(row.provider||"");
  const [cost,setCost] = useState(row.cost||"");
  const [hours,setHours] = useState(row.hours||"");
  const [url,setUrl] = useState(row.url||"");
  const [trainMethod,setTrainMethod] = useState(row.trainMethod||"");
  const [evalMethod,setEvalMethod] = useState(row.evalMethod||"");
  const [targetDate,setTargetDate] = useState(row.targetDate||"");
  const [libSearch,setLibSearch] = useState("");
  const iS={width:"100%",padding:"9px 11px",background:"#F4F9FE",border:"1px solid #DDE9F5",borderRadius:8,color:"#15385C",fontSize:12,boxSizing:"border-box"};
  const lS={display:"block",fontSize:11,color:"#5B7A9E",marginBottom:5,fontWeight:700};

  const sources = getActiveSources()||{};
  const srcList = Object.entries(sources).map(([name,info])=>({name,...info}));
  const filtered = libSearch.trim()? srcList.filter(s=>s.name.toLowerCase().includes(libSearch.toLowerCase())) : srcList;

  const pickSource = (s) => {
  setProgramName(s.name); setProvider(s.provider||""); setCost(s.cost||""); setHours(s.hours||"");
  setUrl(s.url||""); setTrainMethod(s.method||s.type||"");
  setMode("edit");
  };
  const save = () => onSave({programName,provider,cost,hours,url,trainMethod,evalMethod,targetDate});

  return(
  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
   <div style={{background:"#fff",border:"1px solid #C7DBF0",borderRadius:20,width:"100%",maxWidth:500,padding:24,direction:"rtl",maxHeight:"92vh",overflowY:"auto"}}>
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
  <span style={{fontSize:15,fontWeight:900,color:"#8B5CF6"}}>✏️ إعادة تخطيط البند</span>
  <button onClick={onClose} style={{background:"none",border:"none",color:"#8CA3BD",fontSize:22,cursor:"pointer"}}>✕</button>
  </div>
  <div style={{fontSize:11,color:"#8CA3BD",marginBottom:16}}>الموظف: {emp.name} • {emp.job}{row.cat?` • فئة ${row.cat}`:""}</div>

  {/* أزرار المصدر */}
  <div style={{display:"flex",gap:8,marginBottom:16}}>
  <button onClick={()=>setMode(mode==="library"?"edit":"library")} style={{flex:1,padding:"10px",borderRadius:12,border:`1.5px solid ${mode==="library"?"#8B5CF6":"#DDE9F5"}`,background:mode==="library"?"#8B5CF612":"#fff",color:mode==="library"?"#8B5CF6":"#5B7A9E",fontSize:12,fontWeight:800,cursor:"pointer"}}>📖 من مكتبة المصادر</button>
  <button onClick={()=>setMode("manual")} style={{flex:1,padding:"10px",borderRadius:12,border:`1.5px solid ${mode!=="library"?"#8B5CF6":"#DDE9F5"}`,background:mode!=="library"?"#8B5CF612":"#fff",color:mode!=="library"?"#8B5CF6":"#5B7A9E",fontSize:12,fontWeight:800,cursor:"pointer"}}>✏️ إدخال يدوي</button>
  </div>

  {mode==="library"?(
  <div>
   <input value={libSearch} onChange={e=>setLibSearch(e.target.value)} placeholder="🔎 ابحث في المصادر..." style={{...iS,marginBottom:10}}/>
   <div style={{maxHeight:320,overflowY:"auto",display:"flex",flexDirection:"column",gap:6}}>
   {filtered.length===0?<div style={{textAlign:"center",padding:24,color:"#8CA3BD",fontSize:12}}>لا مصادر مطابقة — أضِفها من مكتبة المصادر أولاً</div>:
  filtered.map((s,i)=>(
  <div key={i} onClick={()=>pickSource(s)} style={{background:"#F4F9FE",border:"1px solid #DDE9F5",borderRadius:10,padding:"10px 12px",cursor:"pointer",display:"flex",alignItems:"center",gap:10}}>
  <span style={{fontSize:16}}>{(s.type||"").includes("كتاب")?"📖":"🎓"}</span>
  <div style={{flex:1,minWidth:0}}>
  <div style={{fontSize:12,fontWeight:700,color:"#15385C"}}>{s.name}</div>
  <div style={{fontSize:10,color:"#8CA3BD"}}>{s.type||"—"}{s.provider?` • ${s.provider}`:""}{s.hours?` • ${s.hours}س`:""}{s.cost?` • ${s.cost}`:""}</div>
  </div>
  <span style={{fontSize:11,color:"#8B5CF6",fontWeight:700}}>اختيار ←</span>
  </div>
  ))}
   </div>
  </div>
  ):(
  <div style={{display:"flex",flexDirection:"column",gap:12}}>
   <div><label style={lS}>📚 اسم البرنامج/المصدر</label><input value={programName} onChange={e=>setProgramName(e.target.value)} style={iS}/></div>
   <div><label style={lS}>🏛️ الجهة المنفّذة</label><input value={provider} onChange={e=>setProvider(e.target.value)} style={iS}/></div>
   <div style={{display:"flex",gap:10}}>
   <div style={{flex:1}}><label style={lS}>💰 التكلفة</label><input value={cost} onChange={e=>setCost(e.target.value)} style={iS}/></div>
   <div style={{flex:1}}><label style={lS}>⏱️ الساعات</label><input value={hours} onChange={e=>setHours(e.target.value)} style={iS}/></div>
   </div>
   <div><label style={lS}>🎓 أسلوب التدريب</label>
   <select value={trainMethod} onChange={e=>setTrainMethod(e.target.value)} style={iS}>
  <option value="">— اختر —</option>{IDP_TRAIN_METHODS.map(o=><option key={o} value={o}>{o}</option>)}
   </select></div>
   <div><label style={lS}>📋 أسلوب قياس الأثر</label>
   <select value={evalMethod} onChange={e=>setEvalMethod(e.target.value)} style={iS}>
  <option value="">— اختر —</option>{IDP_EVAL_METHODS.map(o=><option key={o} value={o}>{o}</option>)}
   </select></div>
   <div style={{display:"flex",gap:10}}>
   <div style={{flex:1}}><label style={lS}>📅 التاريخ المستهدف</label><input type="date" value={targetDate} onChange={e=>setTargetDate(e.target.value)} style={iS}/></div>
   <div style={{flex:1}}><label style={lS}>🔗 الرابط</label><input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://..." style={{...iS,direction:"ltr",textAlign:"left"}}/></div>
   </div>
   <div style={{display:"flex",gap:10,marginTop:4}}>
   <button onClick={onClose} style={{flex:1,padding:"11px",borderRadius:12,border:"1px solid #DDE9F5",background:"#fff",color:"#5B7A9E",cursor:"pointer"}}>إلغاء</button>
   <button onClick={save} style={{flex:2,padding:"11px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#6D28D9,#8B5CF6)",color:"#fff",fontWeight:700,cursor:"pointer"}}>💾 حفظ التخطيط</button>
   </div>
  </div>
  )}
   </div>
  </div>
  );
}

function LibraryManager({ onSave }) {
  const [sources, setSources] = useState([]);
  const [compMap, setCompMap] = useState({});
  const [subTab, setSubTab]   = useState("list");
  const [search, setSearch]   = useState("");
  const [typeF,  setTypeF]    = useState("الكل");
  const [editRow,setEditRow]  = useState(null);
  const [expandComp,setExpandComp] = useState(null);
  const [importTxt,setImportTxt]   = useState("");
  const [importErr,setImportErr]   = useState("");
  const [showImport,setShowImport] = useState(false);
  const [toast,setToast] = useState(null);
  const showT = (msg,c="#10B981") => { setToast({msg,c}); setTimeout(()=>setToast(null),2200); };

  useEffect(()=>{
  st.getShared("customSources_360c").then(d=>{ if(d&&d.length){ setSources(d); setActiveSources(d); } });
  st.getShared("customSourceMap_360c").then(d=>{ if(d){ setCompMap(d); setActiveCompMap(d); } });
  },[]);

  const newRow = () => ({id:Date.now(),type:"دورة",method:"إلكتروني",name:"",provider:"",url:"",hours:0,cost:0});

  const saveRow = (row) => {
  if(!row.name.trim()) return;
  setSources(p=>{ const idx=p.findIndex(x=>x.id===row.id); return idx>=0?p.map(x=>x.id===row.id?row:x):[...p,row]; });
  setEditRow(null); showT("✓ تم حفظ المصدر");
  };

  const deleteRow = (id) => {
  const src = sources.find(x=>x.id===id);
  setSources(p=>p.filter(x=>x.id!==id));
  if(src){ setCompMap(m=>{ const nm={...m}; Object.keys(nm).forEach(k=>{nm[k]=nm[k].filter(n=>n!==src.name);}); return nm; }); }
  showT("تم الحذف","#EF4444");
  };

  const toggleLink = (comp,name) => setCompMap(m=>{ const cur=m[comp]||[]; return {...m,[comp]:cur.includes(name)?cur.filter(n=>n!==name):[...cur,name]}; });

  const handleImport = () => {
  setImportErr(""); const txt=importTxt.trim(); if(!txt) return;
  try {
   let parsed;
   if(txt.startsWith("[")||txt.startsWith("{")) { parsed=JSON.parse(txt); if(!Array.isArray(parsed)) parsed=[parsed]; }
   else {
  // ندعم الفاصلة، الفاصلة المنقوطة، والجدولة (tab) — ومرونة في الترويسات
  const splitLine=(l)=>l.split(/[,;\t]/).map(v=>v.trim().replace(/^"|"$/g,""));
  const lines=txt.split(/\r?\n/).filter(l=>l.trim());
  // نكتشف إن كان السطر الأول ترويسة فعلاً (يحوي كلمة ترويسة معروفة)
  const HEAD_HINTS=["name","الاسم","اسم","المصدر","البرنامج","العنوان","type","النوع","method","الأسلوب","provider","الجهة","url","الرابط","hours","الساعات","cost","التكلفة","السعر"];
  const firstCells=splitLine(lines[0]).map(h=>h.trim());
  const looksLikeHeader = firstCells.some(c=>HEAD_HINTS.includes(c));
  if(looksLikeHeader){
   const headers=firstCells;
   parsed=lines.slice(1).map(line=>{ const vals=splitLine(line); const obj={}; headers.forEach((h,i)=>{obj[h]=vals[i]||"";}); return obj; });
  } else {
   // لا ترويسة — كل سطر بيانات؛ العمود الأول = الاسم، والبقية أعمدة عامة بالترتيب
   const cols=["الاسم","الجهة","الساعات","التكلفة","الرابط"];
   parsed=lines.map(line=>{ const vals=splitLine(line); const obj={}; vals.forEach((v,i)=>{obj[cols[i]||`c${i}`]=v;}); return obj; });
  }
   }
   // مطابقة مرنة للاسم: نجرّب عدّة ترويسات محتملة، وإن لم نجد نأخذ أول عمود غير فارغ
   const pick=(r,keys)=>{ for(const k of keys){ if(r[k]!=null&&String(r[k]).trim()) return String(r[k]).trim(); } return ""; };
   const norm=parsed.map((r,i)=>{
    const name=pick(r,["name","الاسم","اسم المصدر","المصدر","البرنامج","اسم البرنامج","العنوان"]) || (Object.values(r).find(v=>v&&String(v).trim())||"");
    return {
     id:Date.now()+i,
     type:pick(r,["type","النوع","نوع المصدر"])||"دورة",
     method:pick(r,["method","الأسلوب","أسلوب"])||"إلكتروني",
     name:String(name).trim(),
     provider:pick(r,["provider","الجهة","المزوّد","المزود","الجهة المقدّمة"]),
     url:pick(r,["url","الرابط","رابط"]),
     hours:Number(pick(r,["hours","الساعات","عدد الساعات"])||0)||0,
     cost:Number(pick(r,["cost","التكلفة","الكلفة","السعر"])||0)||0,
    };
   }).filter(r=>r.name.trim());
   if(!norm.length){ setImportErr("لم يُعثر على بيانات صالحة — تأكّد من وجود عمود لاسم المصدر"); return; }
   setSources(p=>{ const ex=new Set(p.map(x=>x.name.trim())); return [...p,...norm.filter(r=>!ex.has(r.name.trim()))]; });
   showT(`✓ تم استيراد ${norm.length} مصدر`); setShowImport(false); setImportTxt("");
  } catch(e){ setImportErr("خطأ في التحليل: "+e.message); }
  };

  const filtered = useMemo(()=>sources.filter(s=>{
  if(typeF!=="الكل"&&s.type!==typeF) return false;
  const q=search.trim(); if(q&&!(s.name.includes(q)||(s.provider||"").includes(q))) return false;
  return true;
  }),[sources,typeF,search]);

  const allComps = Object.keys(getActiveComps());
  const iS={width:"100%",padding:"8px 10px",background:"#F4F9FE",border:"1px solid #C7DBF0",borderRadius:8,color:"#1E293B",fontSize:12,boxSizing:"border-box"};
  const lS={display:"block",fontSize:10,color:"#5B7A9E",marginBottom:4,fontWeight:700};

  return(
  <div style={{direction:"rtl",fontFamily:"'El Messiri',sans-serif",position:"relative"}}>
   {toast&&<div style={{position:"fixed",top:18,left:"50%",transform:"translateX(-50%)",background:toast.c,color:"#fff",padding:"11px 26px",borderRadius:30,fontWeight:700,fontSize:13,zIndex:9999,boxShadow:`0 8px 28px ${toast.c}55`,animation:"fadeInUp 0.3s ease"}}>{toast.msg}</div>}
   <div style={{background:"#FFFFFF",border:"1px solid #B3D0EA",borderRadius:14,padding:"14px 18px",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
  <div>
  <div style={{fontSize:14,color:"#2E7FB8",fontWeight:900}}>📖 إدارة مكتبة المصادر التدريبية</div>
  <div style={{fontSize:11,color:"#5B7A9E",marginTop:3}}>{sources.length} مصدر • {Object.keys(compMap).filter(k=>compMap[k]?.length>0).length} جدارة مرتبطة</div>
  </div>
  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
  <button onClick={()=>setShowImport(true)} style={{padding:"6px 14px",borderRadius:20,border:"1px solid #8B5CF660",background:"#8B5CF610",color:"#8B5CF6",fontSize:11,cursor:"pointer",fontWeight:700}}>📥 استيراد CSV/JSON</button>
  <button onClick={()=>setEditRow(newRow())} style={{padding:"6px 14px",borderRadius:20,border:"none",background:"linear-gradient(135deg,#059669,#10B981)",color:"#fff",fontSize:11,cursor:"pointer",fontWeight:700}}>➕ إضافة مصدر</button>
  <button onClick={()=>onSave(sources,compMap)} style={{padding:"6px 14px",borderRadius:20,border:"none",background:"linear-gradient(135deg,#1D5A8A,#2E7FB8)",color:"#fff",fontSize:11,cursor:"pointer",fontWeight:700}}>💾 حفظ</button>
  </div>
   </div>

   <div style={{display:"flex",gap:6,marginBottom:12}}>
  {[{k:"list",l:"📋 المصادر"},{k:"links",l:"🔗 الربط بالجدارات"}].map(t=>(
  <button key={t.k} onClick={()=>setSubTab(t.k)} style={{padding:"7px 16px",borderRadius:10,border:`1px solid ${subTab===t.k?"#3B82F6":"#DDE9F5"}`,background:subTab===t.k?"#3B82F620":"#FFFFFF",color:subTab===t.k?"#3B82F6":"#5B7A9E",fontSize:12,fontWeight:700,cursor:"pointer"}}>{t.l}</button>
  ))}
   </div>

   {subTab==="list"&&(
  <div>
  <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
   <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 ابحث بالاسم أو الجهة..." style={{flex:1,minWidth:160,...iS}}/>
   {["الكل","دورة","كتاب"].map(t=>(
   <button key={t} onClick={()=>setTypeF(t)} style={{padding:"6px 12px",borderRadius:20,border:`1px solid ${typeF===t?"#10B98160":"#C7DBF0"}`,background:typeF===t?"#10B98120":"transparent",color:typeF===t?"#10B981":"#5B7A9E",fontSize:11,cursor:"pointer",fontWeight:typeF===t?700:400}}>{t}</button>
   ))}
  </div>
  {sources.length===0&&(
   <div style={{textAlign:"center",padding:40,color:"#5B7A9E",background:"#FFFFFF",borderRadius:12,border:"1px dashed #B3D0EA"}}>
   <div style={{fontSize:32,marginBottom:10}}>📚</div>
   <div style={{marginBottom:12}}>المكتبة فارغة — أضف مصادر يدوياً أو استورد من CSV/JSON</div>
   <div style={{display:"flex",gap:10,justifyContent:"center"}}>
  <button onClick={()=>setEditRow(newRow())} style={{padding:"8px 18px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#059669,#10B981)",color:"#fff",fontWeight:700,cursor:"pointer"}}>➕ إضافة مصدر</button>
  <button onClick={()=>setShowImport(true)} style={{padding:"8px 18px",borderRadius:10,border:"1px solid #8B5CF660",background:"#8B5CF610",color:"#8B5CF6",fontWeight:700,cursor:"pointer"}}>📥 استيراد</button>
   </div>
   </div>
  )}
  <div style={{display:"flex",flexDirection:"column",gap:5,maxHeight:"55vh",overflowY:"auto"}}>
   {filtered.map(s=>{
   const col=s.type==="كتاب"?"#F59E0B":"#10B981";
   return(
  <div key={s.id} style={{background:"#FFFFFF",border:"1px solid #DDE9F5",borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"center",gap:10}}>
  <span style={{fontSize:15,flexShrink:0}}>{s.type==="كتاب"?"📖":"🎓"}</span>
  <div style={{flex:1,minWidth:0}}>
  <div style={{fontSize:12,color:"#1E293B",fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</div>
  <div style={{display:"flex",gap:5,flexWrap:"wrap",marginTop:3}}>
  <span style={{fontSize:9,color:col,background:`${col}12`,padding:"1px 7px",borderRadius:10,fontWeight:700}}>{s.type}</span>
  {s.provider&&<span style={{fontSize:9,color:"#5B7A9E",background:"#DDE9F5",padding:"1px 7px",borderRadius:10}}>🏛️ {s.provider}</span>}
  {s.hours>0&&<span style={{fontSize:9,color:"#5B7A9E",background:"#DDE9F5",padding:"1px 7px",borderRadius:10}}>⏱️ {s.hours}س</span>}
  <span style={{fontSize:9,color:s.cost>0?"#F59E0B":"#10B981",background:s.cost>0?"#F59E0B12":"#10B98112",padding:"1px 7px",borderRadius:10,fontWeight:700}}>{s.cost>0?`💰 ${s.cost}ر`:"🆓 مجاني"}</span>
  </div>
  </div>
  <div style={{display:"flex",gap:5,flexShrink:0}}>
  {isValidUrl(s.url)&&<a href={s.url} target="_blank" rel="noopener noreferrer" style={{padding:"4px 9px",borderRadius:7,background:"#3B82F612",border:"1px solid #3B82F630",color:"#3B82F6",fontSize:10,textDecoration:"none",fontWeight:700}}>🔗</a>}
  <button onClick={()=>setEditRow({...s})} style={{padding:"4px 9px",borderRadius:7,border:"1px solid #3B82F630",background:"#3B82F610",color:"#3B82F6",fontSize:10,cursor:"pointer"}}>تعديل</button>
  <button onClick={()=>deleteRow(s.id)} style={{padding:"4px 9px",borderRadius:7,border:"1px solid #EF444430",background:"#EF444410",color:"#EF4444",fontSize:10,cursor:"pointer"}}>حذف</button>
  </div>
  </div>
   );
   })}
  </div>
  </div>
   )}

   {subTab==="links"&&(
  <div>
  <div style={{fontSize:11,color:"#5B7A9E",marginBottom:10,background:"#FFFFFF",borderRadius:8,padding:"8px 14px"}}>
   📎 اختر لكل جدارة المصادر المرتبطة بها — ستظهر في خطة التطوير تلقائياً
  </div>
  {allComps.length===0&&<div style={{textAlign:"center",padding:30,color:"#5B7A9E"}}>أضف جدارات أولاً من تبويب مصفوفة الجدارات</div>}
  <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:"60vh",overflowY:"auto"}}>
   {allComps.map(cn=>{
   const linked=compMap[cn]||[]; const isOpen=expandComp===cn;
   const col=CAT_COLORS[getActiveComps()[cn]?.cat||"عامة"]||"#5B7A9E";
   return(
  <div key={cn} style={{background:"#FFFFFF",border:`1px solid ${isOpen?col+"40":"#DDE9F5"}`,borderRadius:12,overflow:"hidden"}}>
  <div onClick={()=>setExpandComp(isOpen?null:cn)} style={{padding:"10px 14px",display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}>
  <span style={{color:"#5B7A9E",fontSize:12}}>{isOpen?"▲":"▼"}</span>
  <span style={{flex:1,fontSize:13,color:"#334155",fontWeight:700}}>{cn}</span>
  <span style={{fontSize:9,color:col,background:`${col}15`,padding:"2px 8px",borderRadius:20}}>{linked.length} مصدر</span>
  </div>
  {isOpen&&(
  <div style={{padding:"0 14px 14px",borderTop:`1px solid ${col}15`}}>
  {sources.length===0&&<div style={{fontSize:11,color:"#5B7A9E",padding:"8px 0"}}>أضف مصادر أولاً من تبويب المصادر</div>}
  <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:10,maxHeight:"46vh",overflowY:"auto"}}>
   {sources.map(s=>{
   const lnk=(compMap[cn]||[]).includes(s.name);
   return(
   <div key={s.id} onClick={()=>toggleLink(cn,s.name)}
   style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderRadius:10,border:`1px solid ${lnk?col+"55":"#E3EEF9"}`,background:lnk?`${col}0E`:"#FBFDFF",cursor:"pointer",transition:"all 0.12s"}}>
   <div style={{width:22,height:22,borderRadius:6,border:`2px solid ${lnk?col:"#CBD5E1"}`,background:lnk?col:"#fff",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,color:"#fff",fontSize:13,fontWeight:900}}>{lnk?"✓":""}</div>
   <span style={{fontSize:15,flexShrink:0}}>{s.type==="كتاب"?"📖":"🎓"}</span>
   <div style={{flex:1,minWidth:0}}>
   <div style={{fontSize:12.5,color:lnk?col:"#334155",fontWeight:lnk?700:600,lineHeight:1.5}}>{s.name}</div>
   {(s.provider||s.hours)&&<div style={{fontSize:10,color:"#8CA3BD",marginTop:1}}>{s.provider||""}{s.provider&&s.hours?" • ":""}{s.hours?`${s.hours} ساعة`:""}</div>}
   </div>
   </div>
   );
   })}
  </div>
  </div>
  )}
  </div>
   );
   })}
  </div>
  </div>
   )}

   {editRow&&(
  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:800,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
  <div style={{background:"#FFFFFF",border:"1px solid #B3D0EA",borderRadius:20,width:"100%",maxWidth:500,padding:24,direction:"rtl"}}>
   <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
   <span style={{fontSize:17,fontWeight:900,color:"#15385C",letterSpacing:"-0.3px"}}>{editRow.name?"✏️ تعديل مصدر":"➕ إضافة مصدر"}</span>
   <button onClick={()=>setEditRow(null)} style={{background:"none",border:"none",color:"#5B7A9E",fontSize:20,cursor:"pointer"}}>✕</button>
   </div>
   <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
   <div style={{gridColumn:"1 / -1"}}>
  <label style={lS}>اسم المصدر *</label>
  <input value={editRow.name} onChange={e=>setEditRow(r=>({...r,name:e.target.value}))} placeholder="مثال: دورة إدارة الوقت" style={iS}/>
   </div>
   <div>
  <label style={lS}>النوع</label>
  <select value={editRow.type} onChange={e=>setEditRow(r=>({...r,type:e.target.value}))} style={iS}>
  <option value="دورة">🎓 دورة</option>
  <option value="كتاب">📖 كتاب</option>
  </select>
   </div>
   <div>
  <label style={lS}>الأسلوب</label>
  <select value={editRow.method} onChange={e=>setEditRow(r=>({...r,method:e.target.value}))} style={iS}>
  {["داخلي حضوري أو عن بعد","خارجي حضوري أو عن بعد","إلكتروني","قراءة"].map(m=><option key={m} value={m}>{m}</option>)}
  </select>
   </div>
   <div style={{gridColumn:"1 / -1"}}>
  <label style={lS}>الجهة</label>
  <input value={editRow.provider||""} onChange={e=>setEditRow(r=>({...r,provider:e.target.value}))} placeholder="مثال: معهد الإدارة العامة" style={iS}/>
   </div>
   <div style={{gridColumn:"1 / -1"}}>
  <label style={lS}>الرابط</label>
  <input value={editRow.url||""} onChange={e=>setEditRow(r=>({...r,url:e.target.value}))} placeholder="https://..." style={{...iS,direction:"ltr",textAlign:"left"}}/>
   </div>
   <div>
  <label style={lS}>الساعات</label>
  <input type="number" min="0" value={editRow.hours||0} onChange={e=>setEditRow(r=>({...r,hours:Number(e.target.value)}))} style={iS}/>
   </div>
   <div>
  <label style={lS}>التكلفة (ريال)</label>
  <input type="number" min="0" value={editRow.cost||0} onChange={e=>setEditRow(r=>({...r,cost:Number(e.target.value)}))} placeholder="0 = مجاني" style={iS}/>
   </div>
   </div>
   <div style={{display:"flex",gap:10,marginTop:14}}>
   <button onClick={()=>setEditRow(null)} style={{flex:1,padding:"10px",borderRadius:10,border:"1px solid #C7DBF0",background:"transparent",color:"#5B7A9E",cursor:"pointer"}}>إلغاء</button>
   <button onClick={()=>saveRow(editRow)} disabled={!editRow.name.trim()} style={{flex:2,padding:"10px",borderRadius:10,border:"none",background:editRow.name.trim()?"linear-gradient(135deg,#059669,#10B981)":"#DDE9F5",color:editRow.name.trim()?"#fff":"#334155",fontWeight:700,cursor:editRow.name.trim()?"pointer":"default"}}>💾 حفظ</button>
   </div>
  </div>
  </div>
   )}

   {showImport&&(
  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:800,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
  <div style={{background:"#FFFFFF",border:"1px solid #8B5CF640",borderRadius:20,width:"100%",maxWidth:580,padding:24,direction:"rtl"}}>
   <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
   <span style={{fontSize:17,fontWeight:900,color:"#15385C",letterSpacing:"-0.3px"}}>📥 استيراد CSV / JSON</span>
   <button onClick={()=>{setShowImport(false);setImportTxt("");setImportErr("");}} style={{background:"none",border:"none",color:"#5B7A9E",fontSize:20,cursor:"pointer"}}>✕</button>
   </div>
   <div style={{background:"#F4F9FE",borderRadius:8,padding:"8px 12px",marginBottom:10,fontSize:11,color:"#5B7A9E",lineHeight:1.8}}>
   <strong style={{color:"#94A3B8"}}>CSV:</strong> الأعمدة: <code style={{color:"#10B981"}}>name, type, provider, url, hours, cost, method</code><br/>
   أو عربي: <code style={{color:"#10B981"}}>الاسم، النوع، الجهة، الرابط، الساعات، التكلفة</code><br/>
   <strong style={{color:"#94A3B8"}}>JSON:</strong> مصفوفة كائنات بنفس الحقول
   </div>
   <textarea value={importTxt} onChange={e=>setImportTxt(e.target.value)} rows={8} placeholder="الصق بيانات CSV أو JSON هنا..."
   style={{width:"100%",padding:"10px",background:"#F4F9FE",border:"1px solid #C7DBF0",borderRadius:8,color:"#1E293B",fontFamily:"monospace",fontSize:11,boxSizing:"border-box",resize:"vertical",direction:"ltr"}}/>
   {importErr&&<div style={{color:"#EF4444",fontSize:11,marginTop:6,background:"#EF444412",padding:"6px 10px",borderRadius:7}}>{importErr}</div>}
   <div style={{display:"flex",gap:10,marginTop:10}}>
   <button onClick={()=>{setShowImport(false);setImportTxt("");setImportErr("");}} style={{flex:1,padding:"10px",borderRadius:10,border:"1px solid #C7DBF0",background:"transparent",color:"#5B7A9E",cursor:"pointer"}}>إلغاء</button>
   <button onClick={handleImport} disabled={!importTxt.trim()} style={{flex:2,padding:"10px",borderRadius:10,border:"none",background:importTxt.trim()?"linear-gradient(135deg,#6D28D9,#8B5CF6)":"#DDE9F5",color:importTxt.trim()?"#fff":"#334155",fontWeight:700,cursor:importTxt.trim()?"pointer":"default"}}>📥 استيراد</button>
   </div>
  </div>
  </div>
   )}
  </div>
  );
}

const scopeBranches = (u) => (u.branches&&u.branches.length) ? u.branches : (u.branch?[u.branch]:[]);
// زر تحديث يدوي + عدّاد للتحديث التلقائي (بدل الخروج والدخول)
function RefreshButton({ intervalSec = 25 }) {
  const [count, setCount] = React.useState(intervalSec);
  const [spinning, setSpinning] = React.useState(false);
  React.useEffect(()=>{
    const t = setInterval(()=>setCount(c=>c<=1?intervalSec:c-1), 1000);
    return ()=>clearInterval(t);
  },[intervalSec]);
  const doRefresh = ()=>{ setSpinning(true); setTimeout(()=>{ try{ window.location.reload(); }catch(e){} }, 150); };
  return (
   <button onClick={doRefresh} title="تحديث البيانات الآن" style={{display:"flex",alignItems:"center",gap:6,padding:"5px 12px",borderRadius:20,border:"1px solid #2E7FB840",background:"#2E7FB810",color:"#2E7FB8",fontSize:11,cursor:"pointer",fontWeight:700}}>
   <span style={{display:"inline-block",transition:"transform .3s",transform:spinning?"rotate(360deg)":"none"}}>🔄</span>
   تحديث <span style={{fontSize:9,color:"#8CA3BD",fontFamily:MONO}}>({count})</span>
   </button>
  );
}
// رابط صالح فقط إن بدأ بـ http/https — يمنع تحويل النصوص (مثل "يصلكم لاحقاً") لمسار داخل النظام
const isValidUrl = (u) => typeof u==="string" && /^https?:\/\/.+/i.test(u.trim());
// حالة نافذة تقييم فرع معيّن (تُستخدم في كل اللوحات القيادية لعرض/تعطيل التقييم)
// win = كائن النوافذ الكامل {branches:{br:{isOpen,openDate,closeDate}}}
const branchWindowStatus = (win, branch) => {
  const today = new Date().toISOString().split("T")[0];
  const w = (win && win.branches) ? (win.branches[branch] || {}) : {};
  const isExp = w.closeDate && w.closeDate < today;
  const isOpen = !!w.isOpen && !isExp;
  return isOpen ? {open:true, label:"مفتوح", color:"#10B981", icon:"🔓"}
       : isExp   ? {open:false, label:"انتهت المدة", color:"#8B5CF6", icon:"⌛"}
       :           {open:false, label:"مغلق", color:"#EF4444", icon:"🔒"};
};
const scopeStages   = (u) => (u.stages&&u.stages.length)     ? u.stages   : (u.stage?[u.stage]:[]);

function MultiPick({ label, options, selected, onChange, color="#2E7FB8", hint }) {
  const sel = selected||[];
  const toggle = (v) => onChange(sel.includes(v) ? sel.filter(x=>x!==v) : [...sel,v]);
  return(
  <div style={{gridColumn:"1 / -1"}}>
   <label style={{display:"block",fontSize:11,color:"#5B7A9E",marginBottom:4,fontWeight:700}}>{label} {sel.length>0&&<span style={{color,fontFamily:MONO}}>({sel.length})</span>}</label>
   {hint&&<div style={{fontSize:10,color:"#8CA3BD",marginBottom:6}}>{hint}</div>}
   <div style={{maxHeight:150,overflowY:"auto",background:"#F4F9FE",border:"1px solid #DDE9F5",borderRadius:8,padding:8,display:"flex",flexWrap:"wrap",gap:5}}>
  {options.map(o=>{
  const on = sel.includes(o);
  return(
   <button key={o} type="button" onClick={()=>toggle(o)}
   style={{padding:"5px 11px",borderRadius:20,border:`1px solid ${on?color:"#C7DBF0"}`,background:on?`${color}18`:"#fff",color:on?color:"#8CA3BD",fontSize:11,fontWeight:on?800:500,cursor:"pointer"}}>
   {on?"✓ ":""}{o}
   </button>
  );
  })}
   </div>
  </div>
  );
}

function BarRow({ label, value, max, color, suffix="%", sub }) {
  const pct = max>0 ? Math.min(100,(value/max)*100) : 0;
  return(
  <div style={{marginBottom:8}}>
   <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:3}}>
  <span style={{color:"#15385C",fontWeight:700}}>{label}{sub&&<span style={{color:"#8CA3BD",fontWeight:400}}> {sub}</span>}</span>
  <span style={{color,fontFamily:MONO,fontWeight:800}}>{typeof value==="number"?value.toFixed(1):value}{suffix}</span>
   </div>
   <div style={{height:12,background:"#EDF4FC",borderRadius:20,overflow:"hidden"}}>
  <div style={{width:`${pct}%`,height:"100%",background:`linear-gradient(90deg,${color}99,${color})`,borderRadius:20,transition:"width .6s cubic-bezier(0.4,0,0.2,1)",boxShadow:`0 2px 8px ${color}55`}}/>
   </div>
  </div>
  );
}

function DonutChart({ segments, size=120, label }) {
  const total = segments.reduce((s,x)=>s+x.value,0);
  if (!total) return <div style={{fontSize:11,color:"#8CA3BD",textAlign:"center",padding:20}}>لا بيانات</div>;
  const R=size/2, r=R*0.62; let acc=0;
  const arcs = segments.filter(s=>s.value>0).map((s,i)=>{
  const frac=s.value/total, a0=acc*2*Math.PI-Math.PI/2; acc+=frac;
  const a1=acc*2*Math.PI-Math.PI/2, large=frac>0.5?1:0;
  const p=(ang,rad)=>[R+rad*Math.cos(ang),R+rad*Math.sin(ang)];
  const [x0,y0]=p(a0,R),[x1,y1]=p(a1,R),[x2,y2]=p(a1,r),[x3,y3]=p(a0,r);
  return <path key={i} d={`M${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 ${large} 0 ${x3},${y3} Z`} fill={s.color}/>;
  });
  return(
  <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
   <svg width={size} height={size} style={{flexShrink:0}}>
  {arcs}
  <text x={R} y={R-2} textAnchor="middle" style={{fontSize:19,fontWeight:900,fill:"#15385C",fontFamily:MONO}}>{total}</text>
  <text x={R} y={R+14} textAnchor="middle" style={{fontSize:9,fill:"#8CA3BD"}}>{label||""}</text>
   </svg>
   <div style={{display:"flex",flexDirection:"column",gap:4}}>
  {segments.filter(s=>s.value>0).map((s,i)=>(
  <div key={i} style={{display:"flex",alignItems:"center",gap:6,fontSize:11}}>
   <span style={{width:11,height:11,borderRadius:3,background:s.color,flexShrink:0}}/>
   <span style={{color:"#15385C"}}>{s.label}</span>
   <span style={{color:"#8CA3BD",fontFamily:MONO}}>{s.value} ({Math.round(s.value/total*100)}%)</span>
  </div>
  ))}
   </div>
  </div>
  );
}

function StatCard({ label, value, color, sub, icon }) {
  const ic = icon || (label.match(/^\p{Emoji}+/u)?.[0]) || "";
  const txt = label.replace(/^\p{Emoji}+\s*/u,"");
  return(
  <div style={{flex:1,minWidth:130,background:`linear-gradient(145deg,${color}f0,${color}c0)`,borderRadius:20,padding:"16px 18px",boxShadow:`0 10px 26px ${color}40`,position:"relative",overflow:"hidden"}}>
   <div style={{position:"absolute",top:-18,left:-18,width:70,height:70,borderRadius:"50%",background:"rgba(255,255,255,0.13)"}}/>
   <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,position:"relative"}}>
  {ic&&<span style={{width:30,height:30,borderRadius:10,background:"rgba(255,255,255,0.22)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15}}>{ic}</span>}
  <span style={{fontSize:11,color:"rgba(255,255,255,0.92)",fontWeight:700}}>{txt}</span>
   </div>
   <div style={{fontSize:26,fontWeight:900,color:"#fff",fontFamily:MONO,lineHeight:1,position:"relative"}}>{value}</div>
   {sub&&<div style={{fontSize:10,color:"rgba(255,255,255,0.8)",marginTop:5,position:"relative"}}>{sub}</div>}
  </div>
  );
}

function WeightsEditor({ onSaved }) {
  const cats = ["أساسية","عامة","فنية"];
  // النماذج الأربعة وعناوينها وأطرافها (بالترتيب المطلوب)
  const MODELS = [
    { key:"employee",   title:"معلم / إداري / مشرف مختص",
      parties:["self","peer","supervisor","stage_mgr"] },
    { key:"leader",     title:"مدير مرحلة / مدير مجمع / وكيل / مساعد إداري / مدير إدارة وظيفية / إدارة تنفيذية",
      parties:["self","stage_mgr","subordinate"] },
    { key:"specialist", title:"أخصائي إدارة وظيفية",
      parties:["self","stage_mgr","beneficiary"] },
    { key:"branch_ext", title:"امتداد فني لإدارة وظيفية",
      parties:["self","supervisor","stage_mgr","beneficiary"] },
  ];
  const PARTY_META = {
    self:        { icon:"👤", label:"التقييم الذاتي",  color:"#10B981" },
    peer:        { icon:"👥", label:"زملاء التخصص",    color:"#8B5CF6" },
    supervisor:  { icon:"🔍", label:"المتابع الفني",   color:"#3B82F6" },
    stage_mgr:   { icon:"🏛️", label:"المدير المباشر",  color:"#F97316" },
    subordinate: { icon:"⬆️", label:"المرؤوسون",       color:"#0EA5E9" },
    beneficiary: { icon:"🎯", label:"المستفيدون",       color:"#EC4899" },
  };
  const [data,setData] = useState(()=>exportModelWeights());
  const [dirty,setDirty] = useState(false);

  const partyTotal = (mk,pk)=>cats.reduce((s,c)=>s+(Number(data[mk]?.[pk]?.[c])||0),0);
  const modelTotal = (m)=>m.parties.reduce((s,pk)=>s+partyTotal(m.key,pk),0);
  const setVal = (mk,pk,cat,v)=>{
   const n=Math.max(0,Math.min(100,Number(v)||0));
   setData(p=>({...p,[mk]:{...(p[mk]||{}),[pk]:{...((p[mk]||{})[pk]||{}),[cat]:n}}})); setDirty(true);
  };
  const allValid = MODELS.every(m=>modelTotal(m)===100);
  const save = async()=>{
   applyCustomWeights(data);
   setActiveWeights(data);
   await st.setShared("customWeights_360c",data);
   setDirty(false); onSaved&&onSaved();
  };
  const reset = ()=>{ setData(exportModelWeights()); setDirty(false); };
  const CAT_COLORS = {"أساسية":"#2E7FB8","عامة":"#8B5CF6","فنية":"#F97316"};

  return(
  <div>
   <div style={{fontSize:11,color:"#5B7A9E",background:"#EFF6FE",borderRadius:8,padding:"8px 12px",marginBottom:14,lineHeight:1.7}}>
  عدّل وزن كل طرف في كل فئة، لكل نموذج تقييم على حدة. مجموع كل لوحة يجب أن يساوي <strong>100%</strong>. عمود «عامة/إدارية/قيادية» يمثّل فئة الجدارات العامة. عند غياب طرف في تقييم فعلي، يُحذف وزنه من المقام تلقائياً.
   </div>

   {MODELS.map(m=>{
   const mt=modelTotal(m);
   return(
   <div key={m.key} style={{marginBottom:18,border:`1px solid ${mt===100?"#C7DBF0":"#F59E0B60"}`,borderRadius:14,overflow:"hidden"}}>
   <div style={{background:mt===100?"#F4F9FE":"#FFFBEB",padding:"10px 14px",fontSize:13,fontWeight:800,color:"#15385C",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
   <span>{m.title}</span>
   <span style={{fontFamily:MONO,fontWeight:900,color:mt===100?"#10B981":"#F59E0B"}}>{mt}% {mt===100?"✓":"⚠"}</span>
   </div>
   <div style={{overflowX:"auto"}}>
   <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:420}}>
   <thead><tr style={{background:"#FAFCFF"}}>
   <th style={{padding:"7px 10px",textAlign:"right",color:"#15385C",fontWeight:800,borderBottom:"1px solid #DDE9F5"}}>الطرف</th>
   <th style={{padding:"7px 10px",color:CAT_COLORS["أساسية"],fontWeight:800,borderBottom:"1px solid #DDE9F5"}}>أساسية</th>
   <th style={{padding:"7px 10px",color:CAT_COLORS["عامة"],fontWeight:800,borderBottom:"1px solid #DDE9F5"}}>عامة/إدارية/قيادية</th>
   <th style={{padding:"7px 10px",color:CAT_COLORS["فنية"],fontWeight:800,borderBottom:"1px solid #DDE9F5"}}>فنية</th>
   <th style={{padding:"7px 10px",color:"#5B7A9E",fontWeight:800,borderBottom:"1px solid #DDE9F5"}}>المجموع</th>
   </tr></thead>
   <tbody>
   {m.parties.map(pk=>{
    const meta=PARTY_META[pk]||{icon:"",label:pk,color:"#334155"};
    const t=partyTotal(m.key,pk);
    return(
    <tr key={pk} style={{borderBottom:"1px solid #EEF4FB"}}>
    <td style={{padding:"7px 10px",color:meta.color,fontWeight:700,whiteSpace:"nowrap"}}>{meta.icon} {meta.label}</td>
    {cats.map(c=>(
    <td key={c} style={{padding:"5px 8px",textAlign:"center"}}>
    <input type="number" min="0" max="100" step="0.5" value={data[m.key]?.[pk]?.[c]??0} onChange={e=>setVal(m.key,pk,c,e.target.value)}
     style={{width:56,padding:"6px",background:"#F4F9FE",border:"1px solid #C7DBF0",borderRadius:7,color:"#15385C",fontFamily:MONO,fontSize:12,textAlign:"center"}}/>
    </td>
    ))}
    <td style={{padding:"7px 10px",textAlign:"center",color:meta.color,fontWeight:900,fontFamily:MONO}}>{t}%</td>
    </tr>
    );
   })}
   </tbody>
   </table>
   </div>
   </div>
   );
   })}

   <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8,flexWrap:"wrap",gap:10,position:"sticky",bottom:0,background:"#fff",padding:"8px 0"}}>
  <div style={{fontSize:12,fontWeight:800,color:allValid?"#10B981":"#EF4444"}}>
  {allValid?"✓ كل اللوحات متوازنة (100%)":"⚠ بعض اللوحات لا تساوي 100%"}
  </div>
  <div style={{display:"flex",gap:8}}>
  {dirty&&<button onClick={reset} style={{padding:"8px 16px",borderRadius:10,border:"1px solid #DDE9F5",background:"#fff",color:"#5B7A9E",fontSize:12,cursor:"pointer"}}>تراجع</button>}
  <button onClick={save} disabled={!dirty||!allValid}
   style={{padding:"8px 20px",borderRadius:10,border:"none",background:(dirty&&allValid)?"linear-gradient(135deg,#6D28D9,#8B5CF6)":"#DDE9F5",color:(dirty&&allValid)?"#fff":"#8CA3BD",fontSize:12,fontWeight:800,cursor:(dirty&&allValid)?"pointer":"not-allowed"}}>
   💾 حفظ الأوزان
  </button>
  </div>
   </div>
  </div>
  );
}

function ExecEvalReport({ users, evals, approvals, locks, onOpenCard }) {
  const [selBranch,setSelBranch] = useState("");
  const emps = (users||[]).filter(u=>u.role==="employee");
  const branches = [...new Set(emps.map(u=>u.branch).filter(Boolean))].sort();
  const scope = selBranch ? emps.filter(u=>u.branch===selBranch) : emps;

  const data = useMemo(()=>{
  const stats = scope.map(u=>({u,s:getEmpFullStats(u,evals[u.id]||{})}));
  const withData = stats.filter(x=>x.s?.avg!=null);
  const overall = withData.length? withData.reduce((a,b)=>a+b.s.avg,0)/withData.length : null;
  const lvDist = {"ممتاز":0,"جيد جداً":0,"جيد":0,"مقبول":0,"ضعيف":0};
  withData.forEach(x=>{ const l=getLevel(x.s.avg).label; if(l in lvDist) lvDist[l]++; });
  const partyComp = {};
  EVAL_PARTIES.forEach(p=>{
   const done = scope.filter(u=>Object.keys((evals[u.id]||{})[p.key]||{}).length>0).length;
   partyComp[p.key] = scope.length? Math.round(done/scope.length*100):0;
  });
  const byBranch = branches.map(b=>{
   const bs = stats.filter(x=>x.u.branch===b && x.s?.avg!=null);
   return {b, avg: bs.length? bs.reduce((a,c)=>a+c.s.avg,0)/bs.length : null, n:bs.length, total:emps.filter(u=>u.branch===b).length};
  }).filter(x=>x.avg!=null).sort((a,b)=>b.avg-a.avg);
  const apKeys = Object.keys(approvals||{}).filter(k=>k.endsWith("__eval")&&approvals[k]?.approved);
  return {total:scope.length, withData:withData.length, overall, lvDist, partyComp, byBranch, approvedStages:apKeys.length};
  },[scope,evals,branches,emps,approvals]);

  const lvColors = {"ممتاز":"#10B981","جيد جداً":"#3B82F6","جيد":"#F59E0B","مقبول":"#F97316","ضعيف":"#EF4444"};

  return(
  <div style={{background:BRAND.cardBg,border:`1px solid ${BRAND.cardBorder}`,borderRadius:22,padding:22,boxShadow:"0 8px 30px rgba(46,127,184,0.10)"}}>
   <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10,marginBottom:14}}>
  <div>
  <div style={{fontSize:17,fontWeight:900,color:"#15385C",letterSpacing:"-0.3px"}}>📊 التقرير التنفيذي — تقييم الأداء</div>
  <div style={{fontSize:10,color:"#8CA3BD",marginTop:2}}>{selBranch||"جميع الفروع"} • {data.total} موظف</div>
  </div>
  <select value={selBranch} onChange={e=>setSelBranch(e.target.value)}
  style={{padding:"7px 12px",background:"#fff",border:"1px solid #C7DBF0",borderRadius:9,color:selBranch?"#15385C":"#8CA3BD",fontSize:12}}>
  <option value="">🏛️ جميع الفروع</option>
  {branches.map(b=><option key={b} value={b}>{b}</option>)}
  </select>
   </div>

   <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:16}}>
  <StatCard label="👥 الموظفون" value={data.total} color="#EC4899"/>
  <StatCard label="✅ لديهم تقييم" value={data.withData} color="#06B6D4" sub={data.total?`${Math.round(data.withData/data.total*100)}%`:""}/>
  <StatCard label="🏆 المتوسط العام" value={data.overall!=null?`${((data.overall/5)*100).toFixed(1)}%`:"—"} color="#F59E0B" sub={data.overall!=null?getLevel(data.overall).label:""}/>
  <StatCard label="🏅 مراحل معتمدة" value={data.approvedStages} color="#8B5CF6"/>
   </div>

   <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
  <div style={{flex:"1 1 260px",background:"linear-gradient(150deg,#FFFFFF,#F2F8FE)",border:"1px solid #E3EEF9",borderRadius:18,padding:18}}>
  <div style={{fontSize:13,fontWeight:900,color:"#15385C",marginBottom:12}}>📈 توزيع التقديرات</div>
  <DonutChart label="موظف" segments={Object.entries(data.lvDist).map(([l,v])=>({label:l,value:v,color:lvColors[l]}))}/>
  </div>
  <div style={{flex:"1 1 260px",background:"linear-gradient(150deg,#FFFFFF,#F2F8FE)",border:"1px solid #E3EEF9",borderRadius:18,padding:18}}>
  <div style={{fontSize:13,fontWeight:900,color:"#15385C",marginBottom:12}}>🔄 نسب اكتمال التقييم لكل طرف</div>
  {EVAL_PARTIES.map(p=><BarRow key={p.key} label={`${p.icon} ${p.label}`} value={data.partyComp[p.key]} max={100} color={p.color}/>)}
  </div>
   </div>

   {!selBranch&&data.byBranch.length>0&&(
  <div style={{background:"#F4F9FE",borderRadius:12,padding:14,marginTop:14}}>
  <div style={{fontSize:13,fontWeight:900,color:"#15385C",marginBottom:12}}>🏛️ ترتيب الفروع بمتوسط الأداء</div>
  {data.byBranch.map(x=>{
   const lv=getLevel(x.avg);
   return <BarRow key={x.b} label={x.b} sub={`(${x.n}/${x.total})`} value={(x.avg/5)*100} max={100} color={lv.color}/>;
  })}
  </div>
   )}

   {/* لوحات حالة التقييم لكل مرحلة */}
   {(()=>{
  const grp={};
  scope.forEach(u=>{ const k=`${u.branch||"—"}||${u.stage||"—"}`; (grp[k]=grp[k]||[]).push(u); });
  const keys=Object.keys(grp).sort();
  if(!keys.length) return null;
  return(
  <div style={{marginTop:16}}>
   <div style={{fontSize:14,fontWeight:900,color:"#15385C",marginBottom:12}}>📋 حالة تقييم الأداء لكل مرحلة</div>
   {keys.map(k=>{
   const [br,stg]=k.split("||");
   return(
  <details key={k} style={{background:"#F7FAFE",border:"1px solid #E3EEF9",borderRadius:16,marginBottom:8,overflow:"hidden"}}>
  <summary style={{padding:"12px 16px",cursor:"pointer",fontSize:12,fontWeight:800,color:"#2E7FB8",listStyle:"none"}}>🏛️ {br} — 📚 {stg} <span style={{color:"#8CA3BD",fontWeight:400}}>({grp[k].length})</span></summary>
  <div style={{padding:"0 14px 14px"}}><EvalStatusBoard emps={grp[k]} evals={evals} locks={locks} onOpenCard={onOpenCard}/></div>
  </details>
   );
   })}
  </div>
  );
   })()}
  </div>
  );
}

function ExecGrowthReport({ users, idps, approvals, impactData, onOpenPlan }) {
  const [sub,setSub] = useState("report"); // report | courses
  const [selBranch,setSelBranch] = useState("");
  const [courses,setCourses] = useState({});
  const [savingKey,setSavingKey] = useState(null);

  useEffect(()=>{ st.get("intcourses_360c").then(d=>setCourses(d||{})); },[]);

  const emps = (users||[]).filter(u=>u.role==="employee");
  const branches = [...new Set(emps.map(u=>u.branch).filter(Boolean))].sort();
  const scope = selBranch ? emps.filter(u=>u.branch===selBranch) : emps;

  const data = useMemo(()=>{
  let plans=0,apprv=0,rows=0,done=0,inprog=0,notyet=0,hours=0,cost=0;
  let approvedRows=0, impactMeasured=0;
  const byBranch={}, byCat={"أساسية":0,"عامة":0,"فنية":0};
  scope.forEach(u=>{
   const p=idps[u.id];
   byBranch[u.branch]=byBranch[u.branch]||{plans:0,rows:0,done:0,total:emps.filter(x=>x.branch===u.branch).length};
   if(p?.plan?.length){
  plans++; byBranch[u.branch].plans++;
  if(p.approved) apprv++;
  p.plan.forEach(r=>{
  rows++; byBranch[u.branch].rows++;
  if(r.cat&&byCat[r.cat]!=null) byCat[r.cat]++;
  if(r.status==="تم التنفيذ"){done++;byBranch[u.branch].done++;}
  else if(r.status==="جاري التنفيذ") inprog++;
  else notyet++;
  const h=parseFloat(String(r.hours||"").replace(/[^\d.]/g,"")); if(!isNaN(h))hours+=h;
  const c=parseFloat(String(r.cost||"").replace(/[^\d.]/g,"")); if(!isNaN(c))cost+=c;
  if(p.approved){ approvedRows++;
   const im=(impactData||{})[`${u.id}__${r.id}`];
   if(im&&im.scores&&Object.keys(im.scores).length>0) impactMeasured++;
  }
  });
   }
  });
  const execPct = rows? Math.round((done+inprog*0.5)/rows*100):0;
  const planPct = scope.length? Math.round(plans/scope.length*100):0;
  const brRank = Object.entries(byBranch).filter(([,v])=>v.rows>0)
   .map(([b,v])=>({b,pct:Math.round(v.done/v.rows*100),plans:v.plans,total:v.total}))
   .sort((a,b)=>b.pct-a.pct);
  return {plans,apprv,rows,done,inprog,notyet,hours,cost,execPct,planPct,byCat,brRank,
   impactPct: approvedRows?Math.round((impactMeasured/approvedRows)*100):0, impactMeasured, approvedRows};
  },[scope,idps,emps]);

  const intCourses = useMemo(()=>{
  const srcInfo = getActiveSources()||{};
  const map = {};
  scope.forEach(u=>{
   (idps[u.id]?.plan||[]).forEach(r=>{
  const name = r.programName||r.comp||"";
  if(!name) return;
  const info = srcInfo[name]||{};
  const _mstr = `${info.type||""} ${info.method||""} ${r.sourceType||""} ${r.method||""} ${r.trainMethod||""} ${r.needSource||""}`; const isInternal = _mstr.includes("حضورية داخلية") || _mstr.includes("داخلي حضوري");
  if(!isInternal) return;
  map[name] = map[name]||{name, provider:r.provider||info.provider||"", hours:r.hours||info.hours||"", enrolled:[]};
  map[name].enrolled.push({emp:u, row:r});
   });
  });
  return Object.values(map).sort((a,b)=>b.enrolled.length-a.enrolled.length);
  },[scope,idps]);

  const setCourseData = async (courseName, empId, patch) => {
  const key = `${courseName}__${empId}`;
  setSavingKey(key);
  const nc = {...courses, [key]:{...(courses[key]||{}), ...patch}};
  setCourses(nc); await st.set("intcourses_360c",nc);
  setTimeout(()=>setSavingKey(null),400);
  };

  const attStyle = {"حضر":"#10B981","لم يحضر":"#EF4444","معتذر":"#F59E0B"};

  return(
  <div style={{display:"flex",flexDirection:"column",gap:10}}>
   <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
  {[{k:"report",l:"📊 التقرير التنفيذي",c:"#2E7FB8"},{k:"courses",l:"🏫 إدارة الدورات الحضورية الداخلية",c:"#8B5CF6"}].map(t=>(
  <button key={t.k} onClick={()=>setSub(t.k)}
   style={{flex:"1 1 auto",minWidth:180,padding:"11px 14px",borderRadius:12,border:`2px solid ${sub===t.k?t.c:"#C7DBF0"}`,background:sub===t.k?`linear-gradient(135deg,${t.c}22,${t.c}0D)`:"rgba(255,255,255,0.7)",color:sub===t.k?t.c:"#5B7A9E",fontSize:12,fontWeight:800,cursor:"pointer"}}>
   {t.l}
  </button>
  ))}
   </div>

   {sub==="report"&&(
  <div style={{background:BRAND.cardBg,border:`1px solid ${BRAND.cardBorder}`,borderRadius:22,padding:22,boxShadow:"0 8px 30px rgba(46,127,184,0.10)"}}>
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10,marginBottom:14}}>
   <div>
   <div style={{fontSize:17,fontWeight:900,color:"#15385C",letterSpacing:"-0.3px"}}>🎯 التقرير التنفيذي — التطور المهني</div>
   <div style={{fontSize:10,color:"#8CA3BD",marginTop:2}}>{selBranch||"جميع الفروع"} • {scope.length} موظف</div>
   </div>
   <select value={selBranch} onChange={e=>setSelBranch(e.target.value)}
   style={{padding:"7px 12px",background:"#fff",border:"1px solid #C7DBF0",borderRadius:9,color:selBranch?"#15385C":"#8CA3BD",fontSize:12}}>
   <option value="">🏛️ جميع الفروع</option>
   {branches.map(b=><option key={b} value={b}>{b}</option>)}
   </select>
  </div>

  <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:16}}>
   <StatCard label="📋 خطط موضوعة" value={`${data.plans}/${scope.length}`} color="#2E7FB8" sub={`${data.planPct}%`}/>
   <StatCard label="✅ معتمدة فنياً" value={data.apprv} color="#10B981"/>
   <StatCard label="📊 نسبة التنفيذ" value={`${data.execPct}%`} color="#059669" sub={`${data.done} منجز من ${data.rows}`}/>
   <StatCard label="⏱️ الساعات" value={data.hours%1===0?data.hours:data.hours.toFixed(1)} color="#0891B2"/>
   <StatCard label="💰 التكلفة" value={data.cost>0?data.cost.toLocaleString("en-US"):"0"} color="#D97706"/>
   <StatCard label="📏 قياس الأثر" value={`${data.impactPct}%`} color="#8B5CF6" sub={`${data.impactMeasured} من ${data.approvedRows} بند`}/>
  </div>

  <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
   <div style={{flex:"1 1 250px",background:"linear-gradient(150deg,#FFFFFF,#F2F8FE)",border:"1px solid #E3EEF9",borderRadius:18,padding:18}}>
   <div style={{fontSize:13,fontWeight:900,color:"#15385C",marginBottom:12}}>📈 حالة تنفيذ البنود</div>
   <DonutChart label="بند" segments={[
  {label:"تم التنفيذ",value:data.done,color:"#10B981"},
  {label:"جاري التنفيذ",value:data.inprog,color:"#F59E0B"},
  {label:"لم يتم",value:data.notyet,color:"#EF4444"},
   ]}/>
   </div>
   <div style={{flex:"1 1 250px",background:"linear-gradient(150deg,#FFFFFF,#F2F8FE)",border:"1px solid #E3EEF9",borderRadius:18,padding:18}}>
   <div style={{fontSize:13,fontWeight:900,color:"#15385C",marginBottom:12}}>🎯 توزيع البنود على الفئات</div>
   <DonutChart label="بند" segments={Object.entries(data.byCat).map(([c,v])=>({label:c,value:v,color:CAT_COLORS[c]}))}/>
   </div>
  </div>

  {!selBranch&&data.brRank.length>0&&(
   <div style={{background:"#F4F9FE",borderRadius:12,padding:14,marginTop:14}}>
   <div style={{fontSize:13,fontWeight:900,color:"#15385C",marginBottom:12}}>🏛️ ترتيب الفروع بنسبة التنفيذ</div>
   {data.brRank.map(x=><BarRow key={x.b} label={x.b} sub={`(${x.plans} خطة)`} value={x.pct} max={100} color={x.pct>=70?"#10B981":x.pct>=40?"#F59E0B":"#EF4444"}/>)}
   </div>
  )}

  {/* استعراض منظّم لخطط التطور — حسب الفرع والمرحلة (لمدير النظام بجوار التقرير) */}
  {onOpenPlan&&(()=>{
   const withPlans = scope.filter(u=>(idps[u.id]?.plan||[]).length>0);
   if(withPlans.length===0) return null;
   const byBr = {};
   withPlans.forEach(u=>{ const b=u.branch||"—"; (byBr[b]=byBr[b]||[]).push(u); });
   return (
   <div style={{marginTop:16,borderTop:"2px solid #E3EEF9",paddingTop:16}}>
   <div style={{fontSize:14,fontWeight:900,color:"#15385C",marginBottom:4}}>📋 استعراض خطط التطور المهني</div>
   <div style={{fontSize:11,color:"#8CA3BD",marginBottom:12}}>اطّلاع منظّم على خطة أي موظف حسب الفرع والمرحلة</div>
   {Object.entries(byBr).sort().map(([br,list])=>(
   <details key={br} style={{marginBottom:8,border:"1px solid #E3EEF9",borderRadius:12,overflow:"hidden"}}>
   <summary style={{padding:"10px 14px",cursor:"pointer",fontSize:12,fontWeight:800,color:"#2E7FB8",background:"#F7FBFF",listStyle:"none"}}>🏛️ {br} <span style={{color:"#8CA3BD",fontWeight:600}}>({list.length} خطة)</span></summary>
   <div style={{padding:"6px 10px"}}>
   {list.sort((a,b)=>(a.stage||"").localeCompare(b.stage||"")).map(u=>{
    const plan=idps[u.id]||{}; const rows=plan.plan||[];
    const approved=plan.approved; const isFinal=plan.isFinal;
    const st=approved?{l:"معتمدة",c:"#10B981"}:isFinal?{l:"بانتظار الاعتماد",c:"#F59E0B"}:{l:"مسودّة",c:"#94A3B8"};
    return(
    <div key={u.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",borderBottom:"1px solid #EEF4FB",flexWrap:"wrap"}}>
    <div style={{flex:1,minWidth:140}}>
    <div style={{fontSize:12,fontWeight:700,color:"#15385C"}}>{u.name}</div>
    <div style={{fontSize:10,color:"#8CA3BD"}}>{u.job}{u.stage?` • ${u.stage}`:""} • {rows.length} بند</div>
    </div>
    <span style={{fontSize:9,color:st.c,background:`${st.c}12`,padding:"2px 8px",borderRadius:10,fontWeight:700}}>{st.l}</span>
    <button onClick={()=>onOpenPlan(u)} style={{padding:"5px 12px",borderRadius:8,border:"1px solid #3B82F640",background:"#3B82F612",color:"#3B82F6",fontSize:11,cursor:"pointer",fontWeight:700}}>👁️ عرض الخطة</button>
    </div>
    );
   })}
   </div>
   </details>
   ))}
   </div>
   );
  })()}
  </div>
   )}

   {sub==="courses"&&(
  <div style={{background:BRAND.cardBg,border:`1px solid ${BRAND.cardBorder}`,borderRadius:22,padding:22,boxShadow:"0 8px 30px rgba(46,127,184,0.10)"}}>
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10,marginBottom:12}}>
   <div>
   <div style={{fontSize:17,fontWeight:900,color:"#15385C",letterSpacing:"-0.3px"}}>🏫 إدارة الدورات الحضورية الداخلية</div>
   <div style={{fontSize:10,color:"#8CA3BD",marginTop:2}}>حدّد تاريخ التنفيذ وحالة الحضور لكل موظف — يظهر في حسابه وحسابات المتابعة</div>
   </div>
   <select value={selBranch} onChange={e=>setSelBranch(e.target.value)}
   style={{padding:"7px 12px",background:"#fff",border:"1px solid #C7DBF0",borderRadius:9,color:selBranch?"#15385C":"#8CA3BD",fontSize:12}}>
   <option value="">🏛️ جميع الفروع</option>
   {branches.map(b=><option key={b} value={b}>{b}</option>)}
   </select>
  </div>

  {intCourses.length===0?(
   <div style={{textAlign:"center",padding:40,color:"#8CA3BD"}}>
   <div style={{fontSize:36,marginBottom:10}}>🏫</div>
   <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>لا توجد دورات حضورية داخلية مختارة بعد</div>
   <div style={{fontSize:11}}>تظهر هنا الدورات التي اختارها الموظفون في خططهم من نوع «دورات حضورية داخلية» في مكتبة المصادر</div>
   </div>
  ):intCourses.map(c=>(
   <details key={c.name} style={{background:"#F4F9FE",border:"1px solid #DDE9F5",borderRadius:12,marginBottom:8,overflow:"hidden"}}>
   <summary style={{padding:"12px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:10,listStyle:"none",flexWrap:"wrap"}}>
  <span style={{fontSize:18}}>🏫</span>
  <div style={{flex:1,minWidth:150}}>
  <div style={{fontSize:13,fontWeight:800,color:"#15385C"}}>{c.name}</div>
  <div style={{fontSize:10,color:"#8CA3BD"}}>{c.provider||"—"}{c.hours?` • ${c.hours}س`:""}</div>
  </div>
  <span style={{fontSize:11,fontWeight:800,color:"#8B5CF6",background:"#8B5CF615",padding:"4px 12px",borderRadius:20}}>{c.enrolled.length} مسجّل</span>
   </summary>
   <div style={{padding:"0 14px 14px"}}>
  {c.enrolled.map(({emp,row})=>{
  const key=`${c.name}__${emp.id}`;
  const cd=courses[key]||{};
  const pct = cd.attendPct!==undefined&&cd.attendPct!=="" ? Number(cd.attendPct) : null;
  const eligible = pct!==null && pct > CERT_MIN_ATTENDANCE; // شهادة عند حضور > 75%
  const iS = {padding:"5px 8px",background:"#F4F9FE",border:"1px solid #C7DBF0",borderRadius:7,color:"#15385C",fontSize:10,boxSizing:"border-box"};
  const lbl = {fontSize:9,color:"#8CA3BD",display:"block",marginBottom:2};
  return(
  <div key={emp.id} style={{background:"#fff",border:`1px solid ${eligible?"#10B98140":"#DDE9F5"}`,borderRadius:10,padding:"12px 14px",marginTop:8}}>
  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,flexWrap:"wrap"}}>
   <div style={{flex:1,minWidth:140}}>
   <div style={{fontSize:12,fontWeight:700,color:"#15385C"}}>{emp.name}</div>
   <div style={{fontSize:10,color:"#8CA3BD"}}>{emp.job}{emp.branch?` • ${emp.branch}`:""}{row.targetDate?` • 📅 خطّط: ${row.targetDate}`:""}</div>
   </div>
   {savingKey===key&&<span style={{fontSize:10,color:"#10B981"}}>✓ حُفظ</span>}
  </div>
  {/* الحقول الستة */}
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:8}}>
   <div><label style={lbl}>📅 تاريخ التنفيذ</label><input type="date" value={cd.actualDate||""} onChange={e=>setCourseData(c.name,emp.id,{actualDate:e.target.value})} style={{...iS,width:"100%"}}/></div>
   <div><label style={lbl}>📍 مكان التنفيذ</label><input value={cd.location||""} onChange={e=>setCourseData(c.name,emp.id,{location:e.target.value})} placeholder="القاعة/الفرع..." style={{...iS,width:"100%"}}/></div>
   <div><label style={lbl}>👨‍🏫 اسم المدرب</label><input value={cd.trainer||""} onChange={e=>setCourseData(c.name,emp.id,{trainer:e.target.value})} placeholder="اسم المدرب" style={{...iS,width:"100%"}}/></div>
   <div><label style={lbl}>🔄 حالة التنفيذ</label>
   <select value={cd.status||""} onChange={e=>setCourseData(c.name,emp.id,{status:e.target.value})} style={{...iS,width:"100%"}}>
   <option value="">—</option><option value="لم يبدأ">لم يبدأ</option><option value="جارٍ">جارٍ</option><option value="تم">تم التنفيذ</option>
   </select></div>
   <div><label style={lbl}>📊 مدة الحضور (%)</label><input type="number" min="0" max="100" value={cd.attendPct??""} onChange={e=>setCourseData(c.name,emp.id,{attendPct:e.target.value})} placeholder="0-100" style={{...iS,width:"100%",border:`1px solid ${eligible?"#10B98150":"#C7DBF0"}`}}/></div>
   <div><label style={lbl}>🎓 شهادة الحضور</label>
   {eligible
   ? <button onClick={()=>generateAttendanceCertificate({name:emp.name,courseName:c.name,date:cd.actualDate||"",hours:c.hours||"",trainer:cd.trainer||""})} style={{width:"100%",padding:"6px",borderRadius:7,border:"none",background:"linear-gradient(135deg,#059669,#10B981)",color:"#fff",fontSize:10,fontWeight:700,cursor:"pointer"}}>📄 إصدار الشهادة</button>
   : <div style={{padding:"6px",borderRadius:7,background:"#F1F5F9",color:"#94A3B8",fontSize:9,textAlign:"center"}}>تتطلّب حضور &gt; {CERT_MIN_ATTENDANCE}%</div>}
   </div>
  </div>
  </div>
  );
  })}
   </div>
   </details>
  ))}
  </div>
   )}
  {onOpenPlan && (()=>{
   const withPlans = scope.filter(u=>idps[u.id]?.plan?.length);
   const byBr = {};
   withPlans.forEach(u=>{ (byBr[u.branch]=byBr[u.branch]||[]).push(u); });
   const brs = Object.keys(byBr).sort();
   if(!brs.length) return null;
   return (
   <div style={{marginTop:16}}>
   <div style={{fontSize:14,fontWeight:900,color:"#15385C",marginBottom:12}}>📋 استعراض خطط التطوّر المهني (حسب الفرع)</div>
   {brs.map(br=>(
   <details key={br} style={{background:"#F7FAFE",border:"1px solid #E3EEF9",borderRadius:16,marginBottom:8,overflow:"hidden"}}>
   <summary style={{padding:"12px 16px",cursor:"pointer",fontSize:12,fontWeight:800,color:"#2E7FB8",listStyle:"none"}}>🏛️ {br} <span style={{color:"#8CA3BD",fontWeight:400}}>({byBr[br].length} خطة)</span></summary>
   <div style={{padding:"0 14px 14px",display:"flex",flexDirection:"column",gap:6}}>
   {byBr[br].map(u=>{
    const p=idps[u.id]||{};
    const st_ = p.approved?{l:"معتمدة",c:"#10B981"}:p.isFinal?{l:"بانتظار الاعتماد",c:"#F59E0B"}:{l:"مسودّة",c:"#94A3B8"};
    return(
    <div key={u.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,background:"#fff",border:"1px solid #E3EEF9",borderRadius:10,padding:"9px 12px",flexWrap:"wrap"}}>
    <div><span style={{fontWeight:700,fontSize:12,color:"#15385C"}}>{u.name}</span><span style={{fontSize:10,color:"#8CA3BD",marginRight:8}}>{u.job}{u.stage?` • ${u.stage}`:""}</span></div>
    <div style={{display:"flex",gap:8,alignItems:"center"}}>
    <span style={{fontSize:10,color:st_.c,background:`${st_.c}12`,padding:"2px 10px",borderRadius:10,fontWeight:700}}>{st_.l} • {p.plan.length} بند</span>
    <button onClick={()=>onOpenPlan(u)} style={{padding:"5px 12px",borderRadius:8,border:"1px solid #3B82F640",background:"#3B82F612",color:"#3B82F6",fontSize:11,cursor:"pointer",fontWeight:700}}>👁️ عرض الخطة</button>
    </div>
    </div>
    );
   })}
   </div>
   </details>
   ))}
   </div>
   );
  })()}
  </div>
  );
}

function AdminPanel({ onLogout }) {
  const [tab,setTab] = useState("users");
  const [users,setUsersState] = useState([]);
  const [evals,setEvalsState] = useState({});
  const [idps,setIdpsState] = useState({});
  const [acctRequests,setAcctRequests] = useState([]); // ج-1
  const [form,setForm] = useState({name:"",username:"",password:"",role:"employee",job:"",branch:"",stage:"",nationalId:"",supervisorId:"",stageManagerId:"",peerId:""});
  const [toast,setToast] = useState(null);
  const [viewUser,setViewUser] = useState(null);
  const [viewPlanUser,setViewPlanUser] = useState(null);
  const [editUser,setEditUser] = useState(null);
  const [delConfirm,setDelConfirm] = useState(null);
  const [uSearch,setUSearch] = useState("");
  const [uBranch,setUBranch] = useState("");
  const [uStage,setUStage] = useState("");
  const [uRole,setURole] = useState("");
  const [uGroup,setUGroup] = useState(true);
  const [evalWindow,setEvalWindowState] = useState({isOpen:false,openDate:"",closeDate:"",note:""});
  const [round2,setRound2State] = useState({open:false,openDate:"",closeDate:""}); // ب-4: التقييم الثاني
  const [maintMode,setMaintMode] = useState({enabled:false,message:""}); // وضع الصيانة (تعطيل الدخول)
  const [customComps,setCustomComps] = useState(null);
  const [customRoleItems,setCustomRoleItems] = useState(()=>getCompRoleItems());
  const [customJobs,setCustomJobs] = useState(null);
  const [customWeights,setCustomWeights] = useState(null);
  const [approvals,setApprovals] = useState({});
  const [readings,setReadings] = useState({});
  const [locks,setLocks] = useState({});

  const showToast = (msg,c="#10B981") => { setToast({msg,c}); setTimeout(()=>setToast(null),2500); };

  useEffect(()=>{
  const loadData = ()=>{
  st.get("users_360c").then(u=>setUsersState(u||[]));
  st.get("evals_360c").then(d=>setEvalsState(d||{}));
  st.get("idps_360c").then(d=>setIdpsState(d||{}));
  st.get("approvals_360c").then(d=>setApprovals(d||{}));
  st.get("evalwindow_360c").then(d=>{ if(d) setEvalWindowState(d); });
  st.get("round2_360c").then(d=>{ if(d) setRound2State(d); });
  st.get("acctRequests_360c").then(d=>setAcctRequests(Array.isArray(d)?d:[]));
  st.getShared("maintenanceMode_360c").then(d=>{ if(d) setMaintMode({enabled:!!d.enabled,message:d.message||""}); });
  st.getShared("customComps_360c").then(d=>{ if(d){ setCustomComps(d); setActiveComps(d); COMPETENCIES_WITH_ITEMS=d; } });
  st.getShared("profCerts_360c").then(d=>{ if(d&&d.length){ setProfCerts(d); } });
  st.getShared("customJobs_360c").then(d=>{ if(d){ setCustomJobs(d); setActiveJobs(d); JOB_COMPETENCIES=d; } });
  st.getShared("customWeights_360c").then(d=>{ if(d){ setCustomWeights(d); setActiveWeights(d); if(d.employee||d.leader||d.specialist||d.branch_ext) applyCustomWeights(d); else applyCustomWeights({employee:d}); } });
  st.getShared("customSources_360c").then(d=>{ if(d){ setActiveSources(d); } });
  st.getShared("customSourceMap_360c").then(d=>{ if(d){ setActiveCompMap(d); } });
  };
  loadData();
  const onFocus=()=>loadData();
  window.addEventListener("focus",onFocus);
  const iv=setInterval(loadData,25000);
  return ()=>{ window.removeEventListener("focus",onFocus); clearInterval(iv); };
  },[]);

  const persistUsers = async u => { setUsersState(u); await st.set("users_360c",u); };

  const supervisors = (users||[]).filter(u=>u.role==="supervisor");
  const stageMgrs   = (users||[]).filter(u=>u.role==="stage_mgr");
  const employees   = (users||[]).filter(u=>u.role==="employee");

  const addUser = async () => {
  if (!form.name||!form.username||!form.password||!form.branch) return;
  // تطبيع البريد: إزالة المسافات والمحارف الخفية (قد يُدرجها المتصفّح العربي)
  const cleanUsername = String(form.username).replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g,"").trim();
  if (cleanUsername !== form.username) setForm(p=>({...p,username:cleanUsername}));
  // مدير النظام معفى من فرض الدومين (مسؤول)، لكن نتحقّق أن البريد بصيغة صحيحة عموماً
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanUsername)) { showToast("صيغة البريد غير صحيحة","#EF4444"); return; }
  if (form.nationalId && !/^\d{10}$/.test(String(form.nationalId).trim())) { showToast("رقم الهوية يجب أن يكون 10 أرقام","#EF4444"); return; }
  if ((users||[]).find(u=>u.username===cleanUsername)) { showToast("اسم المستخدم موجود","#EF4444"); return; }
  const newUser = {...form,username:cleanUsername,id:Date.now().toString(),peerIds:form.peerIds||(form.peerId?[form.peerId]:[])};
  try {
   if (typeof window.andlusAPI?.createUser === "function") await window.andlusAPI.createUser(newUser);
   await persistUsers([...(users||[]),newUser]);
   // نعيد قراءة المستخدمين من الخادم فوراً حتى تظهر بياناته (وجداراته حسب مسمّاه) بلا انتظار
   const fresh = await st.get("users_360c");
   if (Array.isArray(fresh)) setUsersState(fresh);
  } catch(e){ showToast("تعذّر إنشاء الحساب: "+(e?.message||"خطأ"),"#EF4444"); return; }
  setForm({name:"",username:"",password:"",role:"employee",job:"",branch:"",stage:"",nationalId:"",supervisorId:"",stageManagerId:"",peerId:""});
  showToast("✓ تم إنشاء الحساب");
  };
  // ج-1: اعتماد الطلب → إنشاء الحساب بكلمة المرور المبدئية التي أدخلها مقدّم الطلب
  const approveAcctReq = async (req) => {
  if ((users||[]).find(u=>u.username===req.username)) { showToast("اسم المستخدم أصبح مستخدماً","#EF4444"); return; }
  // نحدّث حالة الطلب فقط؛ الخادم (عبر approveAccountRequest) يُنشئ الحساب ويحدّث الحالة في معاملة واحدة.
  // (لا نُنشئ المستخدم هنا مباشرةً حتى لا يتعارض مع فحص "اسم المستخدم مستخدم" على الخادم فيبقى الطلب معلّقاً.)
  const nr = acctRequests.map(r=>r.id===req.id?{...r,status:"approved",decidedAt:new Date().toISOString().split("T")[0]}:r);
  try {
   setAcctRequests(nr);
   await st.set("acctRequests_360c",nr);   // يستدعي approveAccountRequest على الخادم
   // نعيد قراءة المستخدمين والطلبات من الخادم لتُحدَّث الحالة فعلياً
   const [freshUsers, freshReqs] = await Promise.all([st.get("users_360c"), st.get("acctRequests_360c").catch(()=>nr)]);
   if (freshUsers) setUsersState(freshUsers);
   if (Array.isArray(freshReqs)) setAcctRequests(freshReqs);
   showToast("✅ اعتُمد الطلب وأُنشئ الحساب");
  } catch(e){
   setAcctRequests(acctRequests); // تراجع
   showToast("تعذّر اعتماد الطلب: "+(e?.message||"خطأ"),"#EF4444");
  }
  };
  const rejectAcctReq = async (req) => {
  const note = typeof prompt!=="undefined" ? prompt("سبب الرفض (اختياري):","") : "";
  const nr = acctRequests.map(r=>r.id===req.id?{...r,status:"rejected",rejectNote:note||"",decidedAt:new Date().toISOString().split("T")[0]}:r);
  setAcctRequests(nr); await st.set("acctRequests_360c",nr);
  showToast("❌ رُفض الطلب","#EF4444");
  };

  const getEmpSummary = (u) => {
  const empEval = evals[u.id]||{};
  const comps = getActiveJobs()[u.job]||[];
  const empSc = calcEmployeeScore(empEval, comps, u);
  const avg = empSc?.score??null;
  const doneParties = EVAL_PARTIES.filter(p=>{
   const allowedCats=PARTY_CATS[p.key]||[];
   const myComps=comps.filter(c=>allowedCats.includes(getCat(c)));
   return myComps.some(c=>Object.values(empEval?.[p.key]?.[c]||{}).some(v=>v>0));
  });
  return { avg, doneParties };
  };

  return (
  <div style={{minHeight:"100vh",background:APP_BG,fontFamily:"'El Messiri',sans-serif",direction:"rtl",color:"#1E293B"}}>
   <link href="https://fonts.googleapis.com/css2?family=El+Messiri:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet"/>
   {toast&&<div style={{position:"fixed",top:18,left:"50%",transform:"translateX(-50%)",background:toast.c,color:"#fff",padding:"11px 26px",borderRadius:30,fontWeight:700,fontSize:13,zIndex:9999,boxShadow:`0 8px 28px ${toast.c}55`,animation:"fadeInUp 0.3s ease"}}>{toast.msg}</div>}

   <header style={{background:"rgba(255,255,255,0.82)",backdropFilter:"blur(14px)",borderBottom:"1px solid #C7DBF0",padding:"0 20px",position:"sticky",top:0,zIndex:100,boxShadow:"0 4px 18px rgba(46,127,184,0.08)"}}>
  <div style={{maxWidth:1300,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",height:54}}>
  <div style={{display:"flex",alignItems:"center",gap:10}}>
   <LogoImg style={{height:32}} size={15}/>
   <div><div style={{fontWeight:900,fontSize:15,color:"#15385C",letterSpacing:"-0.3px"}}>ملف التطور المهني</div><div style={{fontSize:10,color:"#5B7A9E",fontWeight:600}}>⚙️ لوحة مدير النظام • {(users||[]).length} حساب</div></div>
  </div>
  <div style={{display:"flex",gap:5}}>

   {[{k:"users",i:"👥",l:"الحسابات",c:"#EC4899"},{k:"evals",i:"📊",l:"تقييم الأداء",c:"#8B5CF6"},{k:"report",i:"🎯",l:"التطور المهني",c:"#06B6D4"},{k:"competencies",i:"🗂️",l:"مصفوفة الجدارات",c:"#F59E0B"},{k:"library",i:"📖",l:"مكتبة المصادر",c:"#10B981"}].map(t=>(
   <button key={t.k} onClick={()=>setTab(t.k)} style={{display:"flex",alignItems:"center",gap:7,padding:"8px 16px",borderRadius:24,border:"none",background:tab===t.k?`linear-gradient(135deg,${t.c},${t.c}cc)`:"#fff",color:tab===t.k?"#fff":"#5B7A9E",fontSize:12,fontWeight:tab===t.k?800:600,cursor:"pointer",boxShadow:tab===t.k?`0 6px 18px ${t.c}45`:"0 2px 8px rgba(46,127,184,0.08)"}}>
  <span style={{fontSize:14}}>{t.i}</span>{t.l}
   </button>
   ))}
   <PrintButton title="لوحة مدير النظام" branch="جميع الفروع"/>
   <AdminChangePasswordButton/>
   <RefreshButton/><button onClick={onLogout} style={{padding:"5px 11px",borderRadius:20,border:"1px solid #EF444430",background:"#EF444410",color:"#EF4444",fontSize:11,cursor:"pointer",marginRight:6}}>خروج</button>
  </div>
  </div>
   </header>

   <main className="print-area" style={{maxWidth:1300,margin:"0 auto",padding:"18px 16px"}}>

  {tab==="users"&&(
  <div>
  {/* ج-1: طلبات الحسابات المعلّقة */}
  {acctRequests.filter(r=>r.status==="pending").length>0&&(
  <div style={{background:"#FFFFFF",border:"2px solid #F59E0B40",borderRadius:16,padding:18,marginBottom:16}}>
   <div style={{fontSize:14,fontWeight:900,color:"#D97706",marginBottom:10}}>⏳ طلبات فتح حسابات بانتظار اعتمادك ({acctRequests.filter(r=>r.status==="pending").length})</div>
   {acctRequests.filter(r=>r.status==="pending").map(r=>(
   <div key={r.id} style={{background:"#FFFBEB",border:"1px solid #F59E0B30",borderRadius:10,padding:"12px 16px",display:"flex",alignItems:"center",gap:12,marginBottom:8,flexWrap:"wrap"}}>
   <div style={{flex:1,minWidth:200}}>
   <div style={{fontWeight:800,fontSize:13,color:"#15385C"}}>{r.name}</div>
   <div style={{fontSize:11,color:"#5B7A9E",marginTop:2}}>📧 {r.username} • {ROLES_LIST[r.role]}{r.roleSubtype&&ROLE_SUBTYPES[r.role]?` (${ROLE_SUBTYPES[r.role][r.roleSubtype]||""})`:""}{r.job?` • ${r.job}`:""}</div>
   <div style={{fontSize:10,color:"#8CA3BD",marginTop:2}}>الفرع/الإدارة: {r.branch||"—"}{r.stage?` • ${r.stage}`:""} • طلبه: {r.requesterName} • {r.createdAt}</div>
   </div>
   <button onClick={()=>approveAcctReq(r)} style={{padding:"8px 18px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#059669,#10B981)",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>✅ اعتماد وإنشاء</button>
   <button onClick={()=>rejectAcctReq(r)} style={{padding:"8px 16px",borderRadius:10,border:"1px solid #EF444440",background:"#EF444410",color:"#EF4444",fontSize:12,fontWeight:700,cursor:"pointer"}}>❌ رفض</button>
   </div>
   ))}
   <div style={{fontSize:10,color:"#8CA3BD",marginTop:4,lineHeight:1.7}}>💡 عند الاعتماد يُنشأ الحساب بكلمة المرور المبدئية التي حدّدها مقدّم الطلب؛ يمكن للموظف تغييرها من لوحته بعد الدخول.</div>
  </div>
  )}
  <div style={{display:"grid",gridTemplateColumns:"360px 1fr",gap:16}}>
   {/* نموذج الإضافة */}
   <div style={{background:BRAND.cardBg,border:`1px solid ${BRAND.cardBorder}`,borderRadius:20,boxShadow:"0 8px 26px rgba(46,127,184,0.10)",padding:20,height:"fit-content"}}>
   <div style={{fontSize:13,color:"#2E7FB8",fontWeight:800,marginBottom:14}}>➕ إضافة حساب</div>
   <div style={{display:"flex",flexDirection:"column",gap:9}}>
  {[{l:"الاسم *",k:"name"},{l:"اسم المستخدم *",k:"username"},{l:"كلمة المرور *",k:"password",t:"password"},{l:"🪪 رقم الهوية",k:"nationalId",ph:"رقم الهوية الوطنية"}].map(f=>(
  <div key={f.k}>
  <label style={{display:"block",fontSize:11,color:"#5B7A9E",marginBottom:4,fontWeight:700}}>{f.l}</label>
  <input value={form[f.k]||""} type={f.t||"text"} onChange={e=>setForm(p=>({...p,[f.k]:e.target.value}))}
  style={{width:"100%",padding:"8px 10px",background:"#F4F9FE",border:"1px solid #DDE9F5",borderRadius:8,color:"#1E293B",fontSize:12,boxSizing:"border-box"}}/>
  </div>
  ))}
  {[
  {l:"الصلاحية *",k:"role",opts:[{v:"",l:"-- اختر --"},...Object.entries(ROLES_LIST).map(([v,l])=>({v,l}))]},
  ...(isDepartment(form.branch)?[]:[{l:"المرحلة",k:"stage",opts:[{v:"",l:"-- بدون --"},...STAGES.map(s=>({v:s,l:s}))]}]),
  {l:"المسمى الوظيفي",k:"job",opts:[{v:"",l:"-- اختر --"},...Object.keys(customJobs||getActiveJobs()).map(j=>({v:j,l:j}))]},
  ].map(f=>(
  <div key={f.k}>
  <label style={{display:"block",fontSize:11,color:"#5B7A9E",marginBottom:4,fontWeight:700}}>{f.l}</label>
  <select value={form[f.k]||""} onChange={e=>setForm(p=>({...p,[f.k]:e.target.value}))}
  style={{width:"100%",padding:"8px 10px",background:"#F4F9FE",border:"1px solid #DDE9F5",borderRadius:8,color:form[f.k]?"#15385C":"#8CA3BD",fontSize:12}}>
  {f.opts.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
  </select>
  </div>
  ))}
  {ROLE_SUBTYPES[form.role]&&(
  <div>
  <label style={{display:"block",fontSize:11,color:"#5B7A9E",marginBottom:4,fontWeight:700}}>{form.role==="branch_ext"?"🔧 التخصص الفني (الإدارة التابع لها فنياً)":"النوع الفرعي"}</label>
  <select value={form.roleSubtype||""} onChange={e=>setForm(p=>({...p,roleSubtype:e.target.value}))}
  style={{width:"100%",padding:"8px 10px",background:"#F4F9FE",border:"1px solid #DDE9F5",borderRadius:8,color:form.roleSubtype?"#15385C":"#8CA3BD",fontSize:12}}>
  <option value="">-- اختر النوع --</option>
  {Object.entries(ROLE_SUBTYPES[form.role]).map(([v,l])=><option key={v} value={v}>{l}</option>)}
  </select>
  </div>
  )}
  <div>
  <label style={{display:"block",fontSize:11,color:"#5B7A9E",marginBottom:4,fontWeight:700}}>الفرع/الإدارة *</label>
  <select value={form.branch||""} onChange={e=>setForm(p=>({...p,branch:e.target.value}))}
  style={{width:"100%",padding:"8px 10px",background:"#F4F9FE",border:"1px solid #DDE9F5",borderRadius:8,color:form.branch&&form.branch!=="-- اختر الفرع --"?"#15385C":"#8CA3BD",fontSize:12}}>
  {BRANCH_DEPT_LIST.map(b=><option key={b} value={b==="-- اختر الفرع --"?"":b}>{b}</option>)}
  </select>
  </div>
  {form.role==="branch_mgr"&&(
  <MultiPick label="🏛️ الفروع التابعة له" hint="اختر فرعاً أو أكثر — إن تُرك فارغاً يُستخدم الفرع أعلاه فقط"
  options={BRANCHES_LIST.filter(b=>b!=="-- اختر الفرع --")} selected={form.branches} onChange={v=>setForm(p=>({...p,branches:v}))}/>
  )}
  {form.role==="stage_mgr"&&(
  <MultiPick label="📚 المراحل التابعة له" hint={`اختر مرحلة أو أكثر داخل فرع «${form.branch||"—"}»`} color="#10B981"
  options={STAGES} selected={form.stages} onChange={v=>setForm(p=>({...p,stages:v}))}/>
  )}
  {form.role==="supervisor"&&(
  <div>
  <label style={{display:"block",fontSize:11,color:"#5B7A9E",marginBottom:4,fontWeight:700}}>نوع المتابع الفني *</label>
  <select value={form.supervisorType||""} onChange={e=>setForm(p=>({...p,supervisorType:e.target.value}))}
  style={{width:"100%",padding:"8px 10px",background:"#F4F9FE",border:"1px solid #DDE9F5",borderRadius:8,color:form.supervisorType?"#15385C":"#8CA3BD",fontSize:12}}>
  <option value="">-- اختر النوع --</option>
  <option value="مشرف مختص">🔍 مشرف مختص (للمعلمين)</option>
  <option value="وكيل">📋 وكيل (للإداريين)</option>
  </select>
  </div>
  )}
  {form.role==="employee"&&!isDepartment(form.branch)&&[
  {l:"المتابع الفني",k:"supervisorId",opts:[{v:"",l:"-- بدون --"},...supervisors.map(s=>({v:s.id,l:s.name}))]},
  {l:"المدير المباشر",k:"stageManagerId",opts:[{v:"",l:"-- بدون --"},...stageMgrs.map(s=>({v:s.id,l:s.name}))]},
  {l:"الزميل المُقيِّم",k:"peerId",opts:[{v:"",l:"-- بدون --"},...employees.map(e=>({v:e.id,l:e.name}))]}
  ].map(f=>(
  <div key={f.k}>
  <label style={{display:"block",fontSize:11,color:"#5B7A9E",marginBottom:4,fontWeight:700}}>{f.l}</label>
  <select value={form[f.k]||""} onChange={e=>setForm(p=>({...p,[f.k]:e.target.value}))}
  style={{width:"100%",padding:"8px 10px",background:"#F4F9FE",border:"1px solid #DDE9F5",borderRadius:8,color:"#1E293B",fontSize:12}}>
  {f.opts.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
  </select>
  </div>
  ))}
  <button onClick={addUser} disabled={!form.name||!form.username||!form.password||!form.branch}
  style={{padding:"10px",borderRadius:10,border:"none",background:form.name&&form.username&&form.password&&form.branch?"linear-gradient(135deg,#1D5A8A,#2E7FB8)":"#DDE9F5",color:form.name&&form.username&&form.password&&form.branch?"#fff":"#C7DBF0",fontWeight:700,fontSize:13,cursor:"pointer",marginTop:4}}>
  إنشاء الحساب
  </button>
   </div>
   </div>

   {/* قائمة الحسابات مع فلاتر */}
   <div style={{background:BRAND.cardBg,border:`1px solid ${BRAND.cardBorder}`,borderRadius:20,boxShadow:"0 8px 26px rgba(46,127,184,0.10)",overflow:"hidden"}}>
   <div style={{padding:"10px 14px",background:"#F4F9FE",borderBottom:"1px solid #DDE9F5"}}>
  <div style={{fontSize:12,color:"#5B7A9E",fontWeight:700,marginBottom:8}}>الحسابات ({(users||[]).length})</div>
  <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
  <input value={uSearch} onChange={e=>setUSearch(e.target.value)} placeholder="🔎 بحث بالاسم أو المستخدم..."
  style={{flex:"1 1 160px",padding:"6px 10px",background:"#fff",border:"1px solid #DDE9F5",borderRadius:8,color:"#15385C",fontSize:11}}/>
  <select value={uBranch} onChange={e=>setUBranch(e.target.value)} style={{padding:"6px 10px",background:"#fff",border:"1px solid #DDE9F5",borderRadius:8,color:uBranch?"#15385C":"#8CA3BD",fontSize:11}}>
  <option value="">🏛️ كل الفروع</option>
  {[...new Set((users||[]).flatMap(u=>[u.branch,...(u.branches||[])]).filter(Boolean))].sort().map(b=><option key={b} value={b}>{b}</option>)}
  </select>
  <select value={uStage} onChange={e=>setUStage(e.target.value)} style={{padding:"6px 10px",background:"#fff",border:"1px solid #DDE9F5",borderRadius:8,color:uStage?"#15385C":"#8CA3BD",fontSize:11}}>
  <option value="">📚 كل المراحل</option>
  {[...new Set((users||[]).flatMap(u=>[u.stage,...(u.stages||[])]).filter(Boolean))].sort().map(s=><option key={s} value={s}>{s}</option>)}
  </select>
  <select value={uRole} onChange={e=>setURole(e.target.value)} style={{padding:"6px 10px",background:"#fff",border:"1px solid #DDE9F5",borderRadius:8,color:uRole?"#15385C":"#8CA3BD",fontSize:11}}>
  <option value="">👥 كل الأدوار</option>
  {Object.entries(ROLES_LIST).map(([v,l])=><option key={v} value={v}>{l}</option>)}
  </select>
  <button onClick={()=>setUGroup(g=>!g)} style={{padding:"6px 12px",borderRadius:8,border:`1px solid ${uGroup?"#2E7FB8":"#DDE9F5"}`,background:uGroup?"#2E7FB815":"#fff",color:uGroup?"#2E7FB8":"#8CA3BD",fontSize:11,fontWeight:700,cursor:"pointer"}}>{uGroup?"📂 مُجمّع":"📄 قائمة"}</button>
  </div>
   </div>
   <div style={{maxHeight:"70vh",overflowY:"auto",padding:10,display:"flex",flexDirection:"column",gap:6}}>
  {(()=>{
  const inScope=(u,b,s)=>{
  const bs=[u.branch,...(u.branches||[])].filter(Boolean);
  const ss=[u.stage,...(u.stages||[])].filter(Boolean);
  return (!b||bs.includes(b)) && (!s||ss.includes(s));
  };
  const q=uSearch.trim().toLowerCase();
  const list=(users||[]).filter(u=>
  inScope(u,uBranch,uStage) && (!uRole||u.role===uRole) &&
  (!q||`${u.name} ${u.username} ${u.nationalId||""}`.toLowerCase().includes(q)));
  if(list.length===0) return <div style={{textAlign:"center",padding:30,color:"#8CA3BD",fontSize:12}}>لا حسابات مطابقة</div>;
  const renderRow=(u)=>{
  const roleIcon = {admin:"⚙️",branch_mgr:"🏫",stage_mgr:"📚",supervisor:"🔍",employee:"👤"}[u.role]||"👤";
  const roleColor = {admin:"#8B5CF6",branch_mgr:"#EF4444",stage_mgr:"#F97316",supervisor:"#3B82F6",employee:"#10B981"}[u.role]||"#10B981";
  const {doneParties} = u.role==="employee" ? getEmpSummary(u) : {doneParties:[]};
  return (
  <div key={u.id} style={{background:"#F4F9FE",border:"1px solid #DDE9F5",borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"center",gap:10}}>
  <div style={{width:34,height:34,borderRadius:9,background:`${roleColor}15`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{roleIcon}</div>
  <div style={{flex:1,minWidth:0}}>
   <div style={{fontWeight:700,fontSize:12,color:"#1E293B"}}>{u.name}</div>
   <div style={{fontSize:10,color:"#5B7A9E"}}>{u.username} • {ROLES_LIST[u.role]}{u.job?` • ${u.job}`:""}{u.nationalId?<span style={{marginRight:6,color:"#5B7A9E"}}>🪪 {u.nationalId}</span>:""}</div>
   {u.role==="employee"&&doneParties.length>0&&(
   <div style={{display:"flex",gap:4,marginTop:3,flexWrap:"wrap"}}>
   {doneParties.map(p=><span key={p.key} style={{fontSize:9,padding:"1px 6px",borderRadius:10,background:`${p.color}15`,color:p.color,border:`1px solid ${p.color}30`}}>✓ {p.label}</span>)}
   </div>
   )}
  </div>
  <div style={{display:"flex",gap:5,flexShrink:0}}>
   {u.role==="employee"&&(
   <>
   {EVAL_PARTIES.filter(p=>locks[`${u.id}__${p.key}`]).map(p=>(
   <button key={p.key} onClick={async()=>{const nl={...locks};delete nl[`${u.id}__${p.key}`];setLocks(nl);await st.set('locks_360c',nl);showToast(`✓ فُتح قفل ${p.label} لـ ${u.name}`);}}
  style={{padding:"3px 7px",borderRadius:7,border:"1px solid #F59E0B30",background:"#F59E0B10",color:"#F59E0B",fontSize:10,cursor:"pointer",fontWeight:700}} title={`فتح قفل ${p.label}`}>
  🔓
   </button>
   ))}
   <button onClick={()=>setViewUser(u)} style={{padding:"4px 9px",borderRadius:7,border:"1px solid #DDE9F5",background:"transparent",color:"#5B7A9E",fontSize:11,cursor:"pointer"}}>360°</button>
   </>
   )}
   <button onClick={()=>setEditUser({...u})} style={{padding:"4px 9px",borderRadius:7,border:"1px solid #3B82F630",background:"#3B82F610",color:"#3B82F6",fontSize:11,cursor:"pointer"}}>تعديل</button>
   <button onClick={()=>setDelConfirm(u)} style={{padding:"4px 9px",borderRadius:7,border:"1px solid #EF444430",background:"#EF444410",color:"#EF4444",fontSize:11,cursor:"pointer"}}>حذف</button>
  </div>
  </div>
  );
  };
  if(!uGroup) return list.map(renderRow);
  const groups={};
  list.forEach(u=>{
  const b=u.branch||"(بلا فرع)";
  const s=u.role==="employee"||u.role==="stage_mgr" ? (u.stage||"(بلا مرحلة)") : "— إدارة وإشراف —";
  groups[b]=groups[b]||{};
  groups[b][s]=groups[b][s]||[];
  groups[b][s].push(u);
  });
  return Object.keys(groups).sort().map(b=>(
  <div key={b} style={{marginBottom:6}}>
  <div style={{fontSize:12,fontWeight:900,color:"#2E7FB8",background:"#EFF6FE",border:"1px solid #C7DBF0",borderRadius:9,padding:"7px 12px",marginBottom:6}}>🏛️ {b} <span style={{fontSize:10,color:"#8CA3BD",fontFamily:MONO}}>({Object.values(groups[b]).flat().length})</span></div>
  {Object.keys(groups[b]).sort().map(s=>(
   <div key={s} style={{marginBottom:6,paddingRight:8}}>
   <div style={{fontSize:11,fontWeight:800,color:"#059669",marginBottom:4}}>📚 {s} <span style={{fontSize:9,color:"#8CA3BD",fontFamily:MONO}}>({groups[b][s].length})</span></div>
   <div style={{display:"flex",flexDirection:"column",gap:5}}>{groups[b][s].map(renderRow)}</div>
   </div>
  ))}
  </div>
  ));
  })()}
   </div>
   </div>
  </div>
  </div>
  )}

  {tab==="evals"&&(
  <div style={{display:"flex",flexDirection:"column",gap:10}}>
   {/* وضع الصيانة: تعطيل دخول جميع الحسابات عدا مدير النظام */}
   <div style={{background:maintMode.enabled?"#FEF2F2":"#FFFFFF",border:`1px solid ${maintMode.enabled?"#FCA5A5":"#E3EEF9"}`,borderRadius:14,padding:16}}>
   <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:maintMode.enabled?10:0}}>
   <div>
   <div style={{fontSize:14,fontWeight:900,color:maintMode.enabled?"#DC2626":"#15385C"}}>🛠️ وضع الصيانة (تعطيل الدخول)</div>
   <div style={{fontSize:11,color:"#8CA3BD",marginTop:2}}>عند التفعيل، يُمنع دخول جميع الحسابات عدا مدير النظام، مع عرض رسالة «قيد التحديث».</div>
   </div>
   <button onClick={async()=>{ const nm={...maintMode,enabled:!maintMode.enabled}; setMaintMode(nm); await st.setShared("maintenanceMode_360c",nm); showToast(nm.enabled?"🛠️ فُعّل وضع الصيانة — الدخول معطّل":"✅ أُلغي وضع الصيانة — الدخول متاح", nm.enabled?"#DC2626":"#10B981"); }}
    style={{padding:"9px 20px",borderRadius:22,border:"none",background:maintMode.enabled?"linear-gradient(135deg,#DC2626,#EF4444)":"linear-gradient(135deg,#059669,#10B981)",color:"#fff",fontSize:12,fontWeight:800,cursor:"pointer",whiteSpace:"nowrap"}}>
    {maintMode.enabled?"⏹️ إيقاف وإتاحة الدخول":"▶️ تفعيل وضع الصيانة"}
   </button>
   </div>
   {maintMode.enabled&&(
   <div>
   <label style={{fontSize:11,color:"#B45309",fontWeight:700,display:"block",marginBottom:4}}>✍️ رسالة تظهر للمستخدمين وقت الصيانة</label>
   <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
   <input value={maintMode.message} onChange={e=>setMaintMode({...maintMode,message:e.target.value})} placeholder="مثال: النظام قيد التحديث حتى الساعة 5 مساءً، نعتذر عن الإزعاج"
    style={{flex:1,minWidth:220,padding:"9px 12px",borderRadius:10,border:"1px solid #FCA5A5",background:"#fff",fontSize:12,color:"#15385C"}}/>
   <button onClick={async()=>{ await st.setShared("maintenanceMode_360c",maintMode); showToast("✓ حُفظت رسالة الصيانة"); }}
    style={{padding:"9px 18px",borderRadius:10,border:"none",background:"#DC2626",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>💾 حفظ الرسالة</button>
   </div>
   </div>
   )}
   </div>
   {/* أ) نوافذ التقييم لكل فرع */}
   {(()=>{
   const today=new Date().toISOString().split("T")[0];
   const allBranches=[...new Set((users||[]).filter(u=>u.role==="employee").map(u=>u.branch).filter(Boolean))].sort();
   const winOf=(b)=>(evalWindow.branches||{})[b]||{isOpen:false,openDate:"",closeDate:""};
   const setWin=async(b,patch)=>{
  const nb={...(evalWindow.branches||{})}; nb[b]={...winOf(b),...patch};
  const nw={...evalWindow,branches:nb};
  setEvalWindowState(nw); await st.set("evalwindow_360c",nw);
  showToast(`✓ حُدِّثت نافذة ${b}`);
   };
   const setAll=async(open)=>{
  const nb={...(evalWindow.branches||{})};
  allBranches.forEach(b=>{nb[b]={...winOf(b),isOpen:open};});
  const nw={...evalWindow,branches:nb};
  setEvalWindowState(nw); await st.set("evalwindow_360c",nw);
  showToast(open?"🔓 فُتح التقييم لكل الفروع":"🔒 أُغلق التقييم لكل الفروع", open?"#10B981":"#EF4444");
   };
   return(
  <div style={{background:BRAND.cardBg,border:`1px solid ${BRAND.cardBorder}`,borderRadius:22,padding:18,boxShadow:"0 8px 30px rgba(46,127,184,0.10)"}}>
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10,marginBottom:12}}>
  <div style={{fontSize:13,fontWeight:900,color:"#15385C"}}>🗓️ نوافذ التقييم لكل فرع</div>
  <div style={{display:"flex",gap:6}}>
  <button onClick={()=>setAll(true)} style={{padding:"6px 14px",borderRadius:20,border:"1px solid #10B98150",background:"#10B98112",color:"#10B981",fontSize:11,cursor:"pointer",fontWeight:700}}>🔓 فتح الكل</button>
  <button onClick={()=>setAll(false)} style={{padding:"6px 14px",borderRadius:20,border:"1px solid #EF444450",background:"#EF444412",color:"#EF4444",fontSize:11,cursor:"pointer",fontWeight:700}}>🔒 إغلاق الكل</button>
  </div>
  </div>
  {allBranches.length===0?<div style={{textAlign:"center",padding:20,color:"#8CA3BD",fontSize:12}}>لا فروع بها موظفون بعد</div>:
  <div style={{display:"flex",flexDirection:"column",gap:6}}>
  {allBranches.map(b=>{
  const w=winOf(b);
  const isExp=w.closeDate&&w.closeDate<today;
  const isOpen=w.isOpen&&!isExp;
  const sc=isOpen?{l:"مفتوح",c:"#10B981",i:"🔓"}:isExp?{l:"انتهت المدة",c:"#8B5CF6",i:"⌛"}:{l:"مغلق",c:"#EF4444",i:"🔒"};
  const cnt=(users||[]).filter(u=>u.role==="employee"&&u.branch===b).length;
  return(
   <div key={b} style={{background:"#F4F9FE",border:`1px solid ${sc.c}25`,borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
   <span style={{fontSize:18}}>{sc.i}</span>
   <div style={{flex:1,minWidth:150}}>
   <div style={{fontSize:12,fontWeight:800,color:"#15385C"}}>{b} <span style={{fontSize:10,color:"#8CA3BD"}}>({cnt} موظف)</span></div>
   <div style={{fontSize:10,color:sc.c,fontWeight:700}}>{sc.l}{w.openDate?` • من ${w.openDate}`:""}{w.closeDate?` ← ${w.closeDate}`:""}</div>
   </div>
   <input type="date" value={w.openDate||""} onChange={e=>setWin(b,{openDate:e.target.value})} title="تاريخ البدء"
   style={{padding:"5px 8px",background:"#fff",border:"1px solid #C7DBF0",borderRadius:7,color:"#15385C",fontSize:10}}/>
   <input type="date" value={w.closeDate||""} onChange={e=>setWin(b,{closeDate:e.target.value})} title="تاريخ الانتهاء"
   style={{padding:"5px 8px",background:"#fff",border:"1px solid #C7DBF0",borderRadius:7,color:"#15385C",fontSize:10}}/>
   <button onClick={()=>setWin(b,{isOpen:!w.isOpen})}
   style={{padding:"6px 14px",borderRadius:20,border:"none",background:w.isOpen?"linear-gradient(135deg,#DC2626,#EF4444)":"linear-gradient(135deg,#059669,#10B981)",color:"#fff",fontSize:11,cursor:"pointer",fontWeight:700}}>
   {w.isOpen?"🔒 إغلاق":"🔓 فتح"}
   </button>
   </div>
  );
  })}
  </div>}
  </div>
   );
   })()}

   {/* ب-4: لوحة التقييم الثاني */}
   {(()=>{
   const setR2 = async (patch) => { const nw={...round2,...patch}; setRound2State(nw); await st.set("round2_360c",nw); showToast(patch.open!==undefined?(patch.open?"🔓 فُتح التقييم الثاني":"🔒 أُغلق التقييم الثاني"):"✓ حُدِّث التقييم الثاني", patch.open===false?"#EF4444":"#10B981"); };
   return (
   <div style={{background:BRAND.cardBg,border:`2px solid ${round2.open?"#F59E0B50":BRAND.cardBorder}`,borderRadius:22,padding:18,boxShadow:"0 8px 30px rgba(46,127,184,0.10)",marginTop:16}}>
   <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10,marginBottom:10}}>
   <div>
   <div style={{fontSize:14,fontWeight:900,color:"#D97706"}}>🔁 التقييم الثاني</div>
   <div style={{fontSize:11,color:"#5B7A9E",marginTop:2}}>يُفتح للمرشّحين من متابعيهم/مديريهم بعد اعتماد نتائج التقييم الأول</div>
   </div>
   <div style={{display:"flex",alignItems:"center",gap:8}}>
   <span style={{fontSize:12,fontWeight:800,color:round2.open?"#10B981":"#94A3B8",background:round2.open?"#10B98112":"#F1F5F9",padding:"5px 14px",borderRadius:20}}>{round2.open?"🔓 مفتوح":"🔒 مغلق"}</span>
   {round2.open
   ? <button onClick={()=>setR2({open:false})} style={{padding:"8px 18px",borderRadius:12,border:"1px solid #EF444450",background:"#EF444412",color:"#EF4444",fontSize:12,fontWeight:700,cursor:"pointer"}}>🔒 إغلاق التقييم الثاني</button>
   : <button onClick={()=>setR2({open:true,openDate:new Date().toISOString().split("T")[0]})} style={{padding:"8px 18px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#D97706,#F59E0B)",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>🔓 بدء التقييم الثاني</button>}
   </div>
   </div>
   <div style={{background:"#F59E0B0D",border:"1px solid #F59E0B25",borderRadius:10,padding:"10px 14px",fontSize:11,color:"#5B7A9E",lineHeight:1.8}}>
   💡 <strong style={{color:"#D97706"}}>آلية العمل:</strong> بعد اعتماد نتائج التقييم الأول، يرشّح المتابع الفني (أو المدير المباشر) الموظفين الذين يستحقّون فرصة تحسين عبر زرّ «🔁 مرتين». يظهر عندها تبويب «التقييم الثاني» للمرشّح والأطراف المعنية (مغلقاً). عند ضغطك «بدء التقييم الثاني» يُفتح للجميع، وتكون الدرجة النهائية <strong style={{color:"#D97706"}}>متوسط التقييمين</strong>.
   </div>
   </div>
   );
   })()}
   <details style={{background:BRAND.cardBg,border:`1px solid ${BRAND.cardBorder}`,borderRadius:14,overflow:"hidden",boxShadow:BRAND.softShadow}}>
   <summary style={{padding:"14px 16px",cursor:"pointer",fontSize:13,fontWeight:800,color:"#8B5CF6",listStyle:"none"}}>⚖️ مصفوفة الأوزان — قابلة للتعديل (اضغط للفتح)</summary>
   <div style={{padding:"0 16px 16px"}}><WeightsEditor onSaved={()=>showToast("✓ حُفظت الأوزان")}/></div>
   </details>

   {/* ب) التقرير التنفيذي */}
   <ExecEvalReport users={users||[]} evals={evals} approvals={approvals} locks={locks} onOpenCard={(u)=>setViewUser(u)}/>
  </div>
  )}
  {tab==="report"&&(
  <ExecGrowthReport users={users||[]} idps={idps} approvals={approvals} impactData={{}} onOpenPlan={(u)=>setViewPlanUser(u)}/>
  )}
  {tab==="library"&&(<>
  <LibraryManager
   onSave={async(sources,compMap)=>{
   setActiveSources(sources); setActiveCompMap(compMap);
   await st.setShared("customSources_360c", sources);
   await st.setShared("customSourceMap_360c", compMap);
   showToast("✓ تم حفظ المكتبة");
   }}
  />
  <ProfCertsManager certs={getProfCerts()} onSave={async d=>{ setProfCerts(d); await st.setShared("profCerts_360c",d); showToast("✓ تم حفظ الشهادات"); }}/>
  </>)}
  {tab==="competencies"&&(<>
  <CompetenciesEditor
   comps={customComps||COMPETENCIES_WITH_ITEMS}
   jobs={customJobs||JOB_COMPETENCIES}
   roleItems={customRoleItems}
   onSaveRoleItems={async d=>{setCustomRoleItems(d);setCompRoleItems(d); await st.setShared("compRoleItems_360c",d);showToast("✓ تم حفظ تعليم البنود");}}
   onSaveComps={async d=>{setCustomComps(d);setActiveComps(d);COMPETENCIES_WITH_ITEMS=d; await st.setShared("customComps_360c",d);showToast("✓ تم حفظ الجدارات");}}
   onSaveJobs={async d=>{setCustomJobs(d);setActiveJobs(d);JOB_COMPETENCIES=d; await st.setShared("customJobs_360c",d);showToast("✓ تم حفظ ربط المسميات");}}
   onReset={async()=>{setCustomComps(null);setCustomJobs(null);setActiveComps(null);setActiveJobs(null);COMPETENCIES_WITH_ITEMS={}; JOB_COMPETENCIES={}; setActiveComps(null); setActiveJobs(null); await st.setShared("customComps_360c",null); await st.setShared("customJobs_360c",null);showToast("✓ تم الرجوع للإعدادات الافتراضية","#F97316");}}
  />
  </>)}
   </main>

   {viewUser&&<Card360 targetUser={viewUser} empEval={evals[viewUser.id]||{}} idpData={idps[viewUser.id]} onSaveIdp={async d=>{const ni={...idps,[viewUser.id]:d};setIdpsState(ni);await st.set("idps_360c",ni);}} readings={readings} onSaveReadings={async d=>{setReadings(d);await st.set("readings_360c",d);}} currentUser={{id:"__admin__",name:"مدير النظام",role:"admin"}} onClose={()=>setViewUser(null)}/>}

   {viewPlanUser&&(
   <div onClick={()=>setViewPlanUser(null)} style={{position:"fixed",inset:0,background:"rgba(15,56,92,0.55)",zIndex:1000,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"30px 16px",overflowY:"auto"}}>
   <div onClick={e=>e.stopPropagation()} style={{background:"#F7FBFF",borderRadius:20,maxWidth:900,width:"100%",padding:"20px",boxShadow:"0 24px 60px rgba(0,0,0,0.3)"}}>
   <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
   <div><div style={{fontSize:16,fontWeight:900,color:"#15385C"}}>📋 خطة التطوّر المهني — {viewPlanUser.name}</div><div style={{fontSize:11,color:"#8CA3BD"}}>{viewPlanUser.job}{viewPlanUser.stage?` • ${viewPlanUser.stage}`:""}{viewPlanUser.branch?` • ${viewPlanUser.branch}`:""}</div></div>
   <button onClick={()=>setViewPlanUser(null)} style={{background:"none",border:"none",fontSize:22,color:"#5B7A9E",cursor:"pointer"}}>✕</button>
   </div>
   <EmployeeGrowthPlan user={viewPlanUser} empEval={evals[viewPlanUser.id]||{}} idpData={idps[viewPlanUser.id]} onSave={()=>{}} viewerRole="viewer" impactData={{}} minHours={getEvalModel(viewPlanUser)==="leader"?15:12}/>
   </div>
   </div>
   )}

   {editUser&&(
  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
  <div style={{background:"#FFFFFF",border:"1px solid #B3D0EA",borderRadius:20,width:"100%",maxWidth:460,padding:28}}>
   <div style={{display:"flex",justifyContent:"space-between",marginBottom:16}}>
   <span style={{fontWeight:900,color:"#15385C"}}>تعديل: {editUser.name}</span>
   <button onClick={()=>setEditUser(null)} style={{background:"none",border:"none",color:"#5B7A9E",fontSize:20,cursor:"pointer"}}>✕</button>
   </div>
   <div style={{display:"flex",flexDirection:"column",gap:10}}>
   {[{l:"الاسم",k:"name"},{l:"اسم المستخدم",k:"username"},{l:"كلمة المرور الجديدة",k:"password",t:"password",ph:"اتركه فارغاً للإبقاء"},{l:"🪪 رقم الهوية",k:"nationalId",ph:"رقم الهوية الوطنية"}].map(f=>(
  <div key={f.k}><label style={{display:"block",fontSize:11,color:"#5B7A9E",marginBottom:4,fontWeight:700}}>{f.l}</label>
  <input value={editUser[f.k]||""} type={f.t||"text"} placeholder={f.ph||""} onChange={e=>setEditUser(p=>({...p,[f.k]:e.target.value}))}
  style={{width:"100%",padding:"8px 10px",background:"#F4F9FE",border:"1px solid #DDE9F5",borderRadius:8,color:"#1E293B",fontSize:12,boxSizing:"border-box"}}/></div>
   ))}
   <div><label style={{display:"block",fontSize:11,color:"#5B7A9E",marginBottom:4,fontWeight:700}}>الصلاحية</label>
  <select value={editUser.role||""} onChange={e=>setEditUser(p=>({...p,role:e.target.value}))}
  style={{width:"100%",padding:"8px 10px",background:"#F4F9FE",border:"1px solid #DDE9F5",borderRadius:8,color:"#15385C",fontSize:12}}>
  {Object.entries(ROLES_LIST).map(([v,l])=><option key={v} value={v}>{l}</option>)}
  </select></div>
   {ROLE_SUBTYPES[editUser.role]&&(
   <div><label style={{display:"block",fontSize:11,color:"#5B7A9E",marginBottom:4,fontWeight:700}}>{editUser.role==="branch_ext"?"🔧 التخصص الفني (الإدارة التابع لها فنياً)":"النوع الفرعي"}</label>
  <select value={editUser.roleSubtype||""} onChange={e=>setEditUser(p=>({...p,roleSubtype:e.target.value}))}
  style={{width:"100%",padding:"8px 10px",background:"#F4F9FE",border:"1px solid #DDE9F5",borderRadius:8,color:editUser.roleSubtype?"#15385C":"#8CA3BD",fontSize:12}}>
  <option value="">-- اختر النوع --</option>
  {Object.entries(ROLE_SUBTYPES[editUser.role]).map(([v,l])=><option key={v} value={v}>{l}</option>)}
  </select></div>
   )}
   <div><label style={{display:"block",fontSize:11,color:"#5B7A9E",marginBottom:4,fontWeight:700}}>🏛️ الفرع/الإدارة</label>
  <select value={editUser.branch||""} onChange={e=>setEditUser(p=>({...p,branch:e.target.value}))}
  style={{width:"100%",padding:"8px 10px",background:"#F4F9FE",border:"1px solid #DDE9F5",borderRadius:8,color:editUser.branch?"#15385C":"#8CA3BD",fontSize:12}}>
  {BRANCH_DEPT_LIST.map(b=><option key={b} value={b==="-- اختر الفرع --"?"":b}>{b}</option>)}
  </select></div>
   {(editUser.role==="employee"||editUser.role==="stage_mgr")&&!isDepartment(editUser.branch)&&(
  <div><label style={{display:"block",fontSize:11,color:"#5B7A9E",marginBottom:4,fontWeight:700}}>📚 المرحلة</label>
  <select value={editUser.stage||""} onChange={e=>setEditUser(p=>({...p,stage:e.target.value}))}
  style={{width:"100%",padding:"8px 10px",background:"#F4F9FE",border:"1px solid #DDE9F5",borderRadius:8,color:editUser.stage?"#15385C":"#8CA3BD",fontSize:12}}>
  <option value="">-- اختر المرحلة --</option>
  {STAGES.map(s=><option key={s} value={s}>{s}</option>)}
  </select></div>
   )}
   <div><label style={{display:"block",fontSize:11,color:"#5B7A9E",marginBottom:4,fontWeight:700}}>💼 المسمّى الوظيفي</label>
  <select value={editUser.job||""} onChange={e=>setEditUser(p=>({...p,job:e.target.value}))}
  style={{width:"100%",padding:"8px 10px",background:"#F4F9FE",border:"1px solid #DDE9F5",borderRadius:8,color:editUser.job?"#15385C":"#8CA3BD",fontSize:12}}>
  <option value="">-- اختر المسمّى --</option>
  {Object.keys(customJobs||getActiveJobs()).map(j=><option key={j} value={j}>{j}</option>)}
  </select>
  <div style={{fontSize:9,color:"#8CA3BD",marginTop:3}}>تغيير المسمّى يُحدّث الجدارات المرتبطة بالحساب تلقائياً.</div></div>
   {editUser.role==="branch_mgr"&&(
  <MultiPick label="🏛️ الفروع التابعة له" hint="اختر فرعاً أو أكثر"
  options={BRANCHES_LIST.filter(b=>b!=="-- اختر الفرع --")} selected={editUser.branches} onChange={v=>setEditUser(p=>({...p,branches:v}))}/>
   )}
   {editUser.role==="stage_mgr"&&(
  <MultiPick label="📚 المراحل التابعة له" hint={`اختر مرحلة أو أكثر داخل فرع «${editUser.branch||"—"}»`} color="#10B981"
  options={STAGES} selected={editUser.stages} onChange={v=>setEditUser(p=>({...p,stages:v}))}/>
   )}
   {editUser.role==="supervisor"&&(
  <div><label style={{display:"block",fontSize:11,color:"#5B7A9E",marginBottom:4,fontWeight:700}}>نوع المتابع الفني</label>
  <select value={editUser.supervisorType||""} onChange={e=>setEditUser(p=>({...p,supervisorType:e.target.value}))}
  style={{width:"100%",padding:"8px 10px",background:"#F4F9FE",border:"1px solid #DDE9F5",borderRadius:8,color:"#1E293B",fontSize:12}}>
  <option value="">-- اختر النوع --</option>
  <option value="مشرف مختص">🔍 مشرف مختص (للمعلمين)</option>
  <option value="وكيل">📋 وكيل (للإداريين)</option>
  </select></div>
   )}
   {editUser.role==="employee"&&!isDepartment(editUser.branch)&&[
  {l:"المتابع الفني",k:"supervisorId",opts:[{v:"",l:"-- بدون --"},...supervisors.map(s=>({v:s.id,l:s.name}))]},
  {l:"المدير المباشر",k:"stageManagerId",opts:[{v:"",l:"-- بدون --"},...stageMgrs.map(s=>({v:s.id,l:s.name}))]},
  {l:"الزميل المُقيِّم",k:"peerId",opts:[{v:"",l:"-- بدون --"},...employees.filter(e=>e.id!==editUser.id).map(e=>({v:e.id,l:e.name}))]}
   ].map(f=>(
  <div key={f.k}><label style={{display:"block",fontSize:11,color:"#5B7A9E",marginBottom:4,fontWeight:700}}>{f.l}</label>
  <select value={editUser[f.k]||""} onChange={e=>setEditUser(p=>({...p,[f.k]:e.target.value}))}
  style={{width:"100%",padding:"8px 10px",background:"#F4F9FE",border:"1px solid #DDE9F5",borderRadius:8,color:"#1E293B",fontSize:12}}>
  {f.opts.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
  </select></div>
   ))}
   </div>
   <div style={{display:"flex",gap:10,marginTop:18}}>
   <button onClick={()=>setEditUser(null)} style={{flex:1,padding:"10px",borderRadius:10,border:"1px solid #DDE9F5",background:"transparent",color:"#5B7A9E",cursor:"pointer"}}>إلغاء</button>
   <button onClick={async()=>{try{if (typeof window.andlusAPI?.updateUser === "function") await window.andlusAPI.updateUser(editUser.id, editUser);await persistUsers((users||[]).map(u=>u.id===editUser.id?editUser:u));}catch(e){showToast("تعذّر الحفظ: "+(e?.message||"خطأ"),"#EF4444");return;}setEditUser(null);showToast("✓ تم التحديث");}}
  style={{flex:2,padding:"10px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#1D5A8A,#2E7FB8)",color:"#fff",fontWeight:700,cursor:"pointer"}}>حفظ</button>
   </div>
  </div>
  </div>
   )}

   {delConfirm&&(
  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center"}}>
  <div style={{background:"#FFFFFF",border:"1px solid #EF4444",borderRadius:20,padding:32,maxWidth:340,textAlign:"center"}}>
   <div style={{fontSize:36,marginBottom:12}}>🗑️</div>
   <div style={{fontWeight:700,color:"#1E293B",marginBottom:8}}>تأكيد الحذف</div>
   <div style={{color:"#5B7A9E",fontSize:13,marginBottom:22}}>سيُحذف حساب <span style={{color:"#EF4444"}}>{delConfirm.name}</span> نهائياً</div>
   <div style={{display:"flex",gap:10}}>
   <button onClick={()=>setDelConfirm(null)} style={{flex:1,padding:"10px",borderRadius:10,border:"1px solid #DDE9F5",background:"transparent",color:"#5B7A9E",cursor:"pointer"}}>إلغاء</button>
   <button onClick={async()=>{try{if (typeof window.andlusAPI?.deleteUser === "function") await window.andlusAPI.deleteUser(delConfirm.id);await persistUsers((users||[]).filter(u=>u.id!==delConfirm.id));}catch(e){showToast("تعذّر الحذف: "+(e?.message||"خطأ"),"#EF4444");return;}const ne={...evals};delete ne[delConfirm.id];setEvalsState(ne);await st.set("evals_360c",ne);setDelConfirm(null);showToast("تم الحذف","#EF4444");}}
  style={{flex:1,padding:"10px",borderRadius:10,border:"none",background:"#EF4444",color:"#fff",fontWeight:700,cursor:"pointer"}}>حذف</button>
   </div>
  </div>
  </div>
   )}
  </div>
  );
}

function ImpactMeasure({ row, impact, editable, onSave, planApproved, branchApproved }) {
  const method = row.evalMethod || "";
  const def = IMPACT_METHODS[method];
  const done = row.status === "تم التنفيذ";
  const [scores,setScores] = useState(impact?.scores||{});
  const [witnesses,setWitnesses] = useState(impact?.witnesses||[]);
  const [wType,setWType] = useState("رابط");
  const [wVal,setWVal] = useState("");
  const [saved,setSaved] = useState(false);

  if (!method) return <div style={{fontSize:11,color:"#8CA3BD",padding:"6px 0"}}>📏 لم يُحدَّد أسلوب قياس الأثر لهذا البند</div>;
  if (!def) return <div style={{fontSize:11,color:"#8CA3BD",padding:"6px 0"}}>📏 أسلوب غير معروف</div>;
  // شروط تفعيل قياس الأثر بالترتيب: اعتماد المتابع ← اعتماد مدير الفرع ← إتمام التنفيذ
  if (planApproved===false) return <div style={{fontSize:11,color:"#F59E0B",background:"#F59E0B10",borderRadius:8,padding:"8px 12px"}}>⏳ يُنشَّط قياس الأثر بعد اعتماد المتابع الفني للخطة</div>;
  if (branchApproved===false) return <div style={{fontSize:11,color:"#F59E0B",background:"#F59E0B10",borderRadius:8,padding:"8px 12px"}}>⏳ يُنشَّط قياس الأثر بعد اعتماد مدير الفرع للمرحلة</div>;
  if (!done) return <div style={{fontSize:11,color:"#F59E0B",background:"#F59E0B10",borderRadius:8,padding:"8px 12px"}}>⏳ يُنشَّط قياس الأثر بعد إتمام تنفيذ الدورة</div>;

  const avgIdx = def.avgItems || def.items.map((_,i)=>i);
  const vals = avgIdx.map(i=>Number(scores[i])).filter(v=>!isNaN(v)&&v>0);
  const avg = vals.length ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length) : null;

  const setScore = (idx,v) => { const n=Math.max(0,Math.min(100,Number(v)||0)); setScores(p=>({...p,[idx]:n})); setSaved(false); };
  const addWitness = () => { if(!wVal.trim())return; setWitnesses(p=>[...p,{type:wType,value:wVal.trim()}]); setWVal(""); setSaved(false); };
  const delWitness = (i) => { setWitnesses(p=>p.filter((_,x)=>x!==i)); setSaved(false); };
  const save = () => { onSave({scores,witnesses}); setSaved(true); };

  const wIcon = {"رابط":"🔗","صورة":"🖼️","ملف":"📎"};

  return(
  <div style={{background:"#F7FAFE",border:"1px solid #E3EEF9",borderRadius:12,padding:14,marginTop:8}}>
   <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8,marginBottom:10}}>
  <div style={{fontSize:12,fontWeight:800,color:"#8B5CF6"}}>📏 قياس الأثر — {method}</div>
  {avg!=null&&<div style={{fontSize:13,fontWeight:900,color:"#8B5CF6",background:"#8B5CF615",padding:"3px 12px",borderRadius:20,fontFamily:MONO}}>المتوسط: {avg}%</div>}
   </div>

   {/* بنود التقييم */}
   <div style={{display:"flex",flexDirection:"column",gap:6}}>
  {def.items.map((it,idx)=>{
  const inAvg = avgIdx.includes(idx);
  const v = scores[idx];
  return(
   <div key={idx} style={{display:"flex",alignItems:"center",gap:10,background:"#fff",border:"1px solid #EDF4FC",borderRadius:9,padding:"8px 11px"}}>
   <div style={{flex:1,fontSize:11,color:"#15385C",lineHeight:1.5}}>
  {idx+1}. {it}
  {!inAvg&&<span style={{fontSize:9,color:"#B6C7DA",marginRight:6}}>(لا يدخل المتوسط)</span>}
   </div>
   {editable?(
  <div style={{display:"flex",alignItems:"center",gap:3}}>
  <input type="number" min="0" max="100" value={v??""} onChange={e=>setScore(idx,e.target.value)}
  style={{width:56,padding:"5px 6px",background:"#F4F9FE",border:"1px solid #C7DBF0",borderRadius:7,color:"#15385C",fontFamily:MONO,fontSize:12,textAlign:"center"}}/>
  <span style={{fontSize:11,color:"#8CA3BD"}}>%</span>
  </div>
   ):(
  <div style={{fontSize:13,fontWeight:800,color:v>0?"#8B5CF6":"#B6C7DA",fontFamily:MONO,minWidth:44,textAlign:"left"}}>{v>0?`${v}%`:"—"}</div>
   )}
   </div>
  );
  })}
   </div>

   {/* الشواهد */}
   {!def.noWitness&&(
  <div style={{marginTop:10}}>
  <div style={{fontSize:11,fontWeight:700,color:"#5B7A9E",marginBottom:6}}>📎 الشواهد <span style={{color:"#8CA3BD",fontWeight:400}}>({def.witnessLabel})</span></div>
  {witnesses.length>0&&(
   <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:8}}>
   {witnesses.map((w,i)=>(
  <div key={i} style={{display:"flex",alignItems:"center",gap:8,background:"#fff",border:"1px solid #EDF4FC",borderRadius:8,padding:"6px 10px"}}>
  <span style={{fontSize:13}}>{wIcon[w.type]||"📎"}</span>
  <span style={{flex:1,fontSize:11,color:"#15385C",wordBreak:"break-all"}}>{w.type==="رابط"&&isValidUrl(w.value)?<a href={w.value} target="_blank" rel="noreferrer" style={{color:"#2E7FB8"}}>{w.value}</a>:w.value}</span>
  {editable&&<button onClick={()=>delWitness(i)} style={{background:"none",border:"none",color:"#EF4444",cursor:"pointer",fontSize:14}}>✕</button>}
  </div>
   ))}
   </div>
  )}
  {editable&&(
   <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
   <select value={wType} onChange={e=>setWType(e.target.value)} style={{padding:"6px 10px",background:"#F4F9FE",border:"1px solid #C7DBF0",borderRadius:8,color:"#15385C",fontSize:11}}>
  <option value="رابط">🔗 رابط</option><option value="صورة">🖼️ صورة</option><option value="ملف">📎 ملف</option>
   </select>
   <input value={wVal} onChange={e=>setWVal(e.target.value)} placeholder={wType==="رابط"?"https://... رابط الشاهد":"اسم الملف أو وصف الصورة"}
  style={{flex:1,minWidth:150,padding:"6px 10px",background:"#F4F9FE",border:"1px solid #C7DBF0",borderRadius:8,color:"#15385C",fontSize:11,direction:wType==="رابط"?"ltr":"rtl"}}/>
   <button onClick={addWitness} style={{padding:"6px 14px",borderRadius:8,border:"none",background:"#8B5CF6",color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>+ إضافة</button>
   </div>
  )}
  {!editable&&witnesses.length===0&&<div style={{fontSize:10,color:"#B6C7DA"}}>لا شواهد مرفقة بعد</div>}
  </div>
   )}

   {editable&&(
  <div style={{display:"flex",justifyContent:"flex-end",marginTop:12}}>
  <button onClick={save} style={{padding:"8px 20px",borderRadius:20,border:"none",background:saved?"#10B981":"linear-gradient(135deg,#6D28D9,#8B5CF6)",color:"#fff",fontSize:12,fontWeight:800,cursor:"pointer"}}>{saved?"✓ محفوظ":"💾 حفظ قياس الأثر"}</button>
  </div>
   )}
  </div>
  );
}

function SupervisorTeamGrowth({ myTargets, idps, evals, editRequests, approvals, impactData, onSaveImpact, user, onApprove, onSaveIdp, onRequestEdit, onOpenPlan }) {
  const [expanded,setExpanded] = useState(null);
  const [editModal,setEditModal] = useState(null); // {emp, rowId}

  const statusColor = { "تم التنفيذ":"#10B981", "جاري التنفيذ":"#F59E0B", "لم يتم التنفيذ":"#EF4444" };

  const setRowStatus = (empId, rowId, status) => {
  const cur = idps[empId]||{};
  const np = (cur.plan||[]).map(r=>r.id===rowId?{...r,status}:r);
  onSaveIdp(empId, {...cur, plan:np});
  };
  const approve = (empId) => {
  const cur = idps[empId]||{};
  const emp = myTargets.find(u=>u.id===empId);
  const stagePlansApproved = emp && approvals && approvals[`${emp.branch}__${emp.stage}__plans`]?.approved;
  onApprove(empId, {...cur, approved:true, approvedBy:user.name, approvedAt:new Date().toISOString().split("T")[0], ...(stagePlansApproved?{needsBranchApproval:true}:{})});
  };

  if (!myTargets.length) return <div style={{textAlign:"center",padding:50,color:"#5B7A9E"}}><div style={{fontSize:40,marginBottom:12}}>👥</div>لا يوجد موظفون مرتبطون بك فنياً</div>;

  return(
  <div>
   <div style={{background:"#10B9810D",border:"1px solid #10B98130",borderRadius:12,padding:"12px 16px",marginBottom:14,fontSize:12,color:"#94A3B8",lineHeight:1.7}}>
  👥 متابعة خطط التطور المهني لموظفيك: اعتماد الخطط، متابعة التنفيذ، وطلب تعديل بند (بديل) بموافقة مدير الفرع.
   </div>

   {myTargets.map(u=>{
  const plan = idps[u.id]||{};
  const rows = plan.plan||[];
  const approved = plan.approved;
  const isOpen = expanded===u.id;
  const req = editRequests[u.id];
  const doneCount = rows.filter(r=>r.status==="تم التنفيذ").length;
  const pct = rows.length? Math.round((doneCount + rows.filter(r=>r.status==="جاري التنفيذ").length*0.5)/rows.length*100):0;
  return(
  <div key={u.id} style={{background:"#FFFFFF",border:`1px solid ${approved?"#10B98125":"#DDE9F5"}`,borderRadius:14,marginBottom:10,overflow:"hidden"}}>
   {/* رأس الموظف */}
   <div onClick={()=>setExpanded(isOpen?null:u.id)} style={{padding:"14px 16px",display:"flex",alignItems:"center",gap:12,cursor:"pointer"}}>
   <span style={{color:"#5B7A9E",fontSize:13}}>{isOpen?"▲":"▼"}</span>
   <div style={{width:38,height:38,borderRadius:10,background:approved?"#10B98115":"#F4F9FE",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,flexShrink:0}}>{approved?"✅":"🎯"}</div>
   <div style={{flex:1,minWidth:0}}>
  <div style={{fontWeight:700,fontSize:13,color:"#1E293B"}}>{u.name}</div>
  <div style={{fontSize:11,color:"#5B7A9E"}}>{u.job} • {rows.length} بند{approved?` • تنفيذ ${pct}%`:""}</div>
   </div>
   <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
  {req&&req.status==="pending"&&<span style={{fontSize:9,color:"#F59E0B",background:"#F59E0B12",padding:"2px 8px",borderRadius:10,fontWeight:700}}>⏳ طلب تعديل معلّق</span>}
  {req&&req.status==="approved"&&<span style={{fontSize:9,color:"#10B981",background:"#10B98112",padding:"2px 8px",borderRadius:10,fontWeight:700}}>✓ تعديل معتمد</span>}
  {approved
  ? <span style={{fontSize:10,color:"#10B981",background:"#10B98115",padding:"3px 10px",borderRadius:20,fontWeight:700}}>معتمدة من الفني</span>
  : <span style={{fontSize:10,color:"#F59E0B",background:"#F59E0B15",padding:"3px 10px",borderRadius:20,fontWeight:700}}>بانتظار الفني</span>}
   </div>
   </div>

   {isOpen&&(
   <div style={{padding:"0 16px 16px",borderTop:"1px solid #DDE9F5"}}>
  {rows.length===0?(
  <div style={{textAlign:"center",padding:20,color:"#5B7A9E",fontSize:12}}>لم يضع الموظف خطته بعد</div>
  ):(
  <>
  {/* أزرار الإجراءات */}
  <div style={{display:"flex",gap:8,flexWrap:"wrap",margin:"14px 0"}}>
  <button onClick={()=>onOpenPlan(u)} style={{padding:"7px 14px",borderRadius:8,border:"1px solid #3B82F640",background:"#3B82F612",color:"#3B82F6",fontSize:11,cursor:"pointer",fontWeight:700}}>👁️ عرض الخطة كاملة</button>
  {!approved&&plan.isFinal&&<button onClick={()=>approve(u.id)} style={{padding:"7px 14px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#059669,#10B981)",color:"#fff",fontSize:11,cursor:"pointer",fontWeight:700}}>✅ اعتماد الخطة</button>}
  {!approved&&!plan.isFinal&&<span style={{padding:"7px 14px",borderRadius:8,background:"#F1F5F9",border:"1px solid #E2E8F0",color:"#94A3B8",fontSize:11,fontWeight:700}} title="لم يُنهِ الموظف التخطيط بعد (في مرحلة الحفظ المؤقت)">⏳ بانتظار إغلاق الموظف للتخطيط</span>}
  {approved&&(!req||req.status!=="pending")&&<button onClick={()=>setEditModal({emp:u,rows})} style={{padding:"7px 14px",borderRadius:8,border:"1px solid #F59E0B40",background:"#F59E0B12",color:"#F59E0B",fontSize:11,cursor:"pointer",fontWeight:700}}>✏️ طلب تعديل بند (بديل)</button>}
  </div>

  {/* بنود الخطة مع حالة التنفيذ */}
  {rows.map((r,i)=>{
  const sc = statusColor[r.status]||"#5B7A9E";
  // ج-4: الدورة الحضورية الداخلية — التنفيذ من إدارة التدريب لا الموظف
  const _ms = `${r.trainMethod||""} ${r.sourceType||""} ${r.needSource||""} ${r.method||""}`; const isInternalCourse = _ms.includes("حضورية داخلية") || _ms.includes("داخلي حضوري");
  return(
   <div key={r.id} style={{background:"#F4F9FE",border:`1px solid ${sc}25`,borderRadius:10,padding:"10px 14px",marginBottom:6}}>
   <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
   <div style={{flex:1,minWidth:0}}>
   <div style={{fontSize:12,color:"#1E293B",fontWeight:700}}>{r.cat?`[${r.cat}] `:""}{r.programName||r.comp||`بند ${i+1}`}{isInternalCourse&&<span style={{fontSize:9,color:"#8B5CF6",background:"#8B5CF612",padding:"1px 7px",borderRadius:10,marginRight:6,fontWeight:700}}>🏫 دورة داخلية</span>}</div>
   <div style={{fontSize:10,color:"#5B7A9E",marginTop:2}}>{r.provider||"—"}{r.hours?` • ${r.hours}س`:""}{r.cost?` • ${r.cost}`:""}{r.evalMethod?` • 📏 ${r.evalMethod}`:""}</div>
   </div>
   {isInternalCourse?(
   <span style={{fontSize:10,color:"#8B5CF6",background:"#8B5CF610",border:"1px solid #8B5CF630",borderRadius:8,padding:"5px 10px",fontWeight:700}}>⏳ يصلكم لاحقاً من التدريب — يُفضّل الانتهاء من الدورات خلال الفصل الأول</span>
   ):approved?(
   <select value={r.status||"لم يتم التنفيذ"} onChange={e=>setRowStatus(u.id,r.id,e.target.value)}
  style={{padding:"5px 8px",background:"#FFFFFF",border:`1px solid ${sc}40`,borderRadius:8,color:sc,fontSize:11,fontWeight:700,cursor:"pointer"}}>
  {["لم يتم التنفيذ","جاري التنفيذ","تم التنفيذ"].map(s=><option key={s} value={s}>{s}</option>)}
   </select>
   ):<span style={{fontSize:10,color:"#5B7A9E"}}>—</span>}
   </div>
   {approved&&!isInternalCourse&&<ImpactMeasure row={r} impact={impactData?.[`${u.id}__${r.id}`]} editable onSave={d=>onSaveImpact(u.id,r.id,d)} planApproved={!!approved} branchApproved={!!(approvals&&approvals[`${u.branch}__${u.stage}__plans`]?.approved)}/>}
   </div>
  );
  })}

  {/* متوسط قياس الأثر للبنود التطويرية */}
  {(()=>{
   const withImpact = rows.filter(r=>r.status==="تم التنفيذ"&&r.evalMethod&&IMPACT_METHODS[r.evalMethod]);
   const avgs = withImpact.map(r=>{
  const im=impactData?.[`${u.id}__${r.id}`]; if(!im?.scores)return null;
  const def=IMPACT_METHODS[r.evalMethod]; const ai=def.avgItems||def.items.map((_,i)=>i);
  const vs=ai.map(i=>Number(im.scores[i])).filter(v=>!isNaN(v)&&v>0);
  return vs.length?vs.reduce((a,b)=>a+b,0)/vs.length:null;
   }).filter(x=>x!=null);
   if(avgs.length<1) return null;
   const overall=Math.round(avgs.reduce((a,b)=>a+b,0)/avgs.length);
   return(
  <div style={{background:"linear-gradient(135deg,#8B5CF618,#8B5CF608)",border:"1px solid #8B5CF630",borderRadius:12,padding:"12px 16px",marginTop:10,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
  <div style={{fontSize:12,fontWeight:800,color:"#7C3AED"}}>📊 متوسط أثر التدريب للبنود التطويرية ({avgs.length})</div>
  <div style={{fontSize:17,fontWeight:900,color:"#7C3AED",fontFamily:MONO}}>{overall}%</div>
  </div>
   );
  })()}
  </>
  )}
   </div>
   )}
  </div>
  );
   })}

   {/* نافذة طلب تعديل بند (بديل) */}
   {editModal&&(
  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>{if(e.target===e.currentTarget)setEditModal(null);}}>
  <div style={{background:"#FFFFFF",border:"1px solid #F59E0B40",borderRadius:20,width:"100%",maxWidth:520,padding:24,direction:"rtl",maxHeight:"90vh",overflowY:"auto"}}>
   <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
   <span style={{fontSize:15,fontWeight:900,color:"#D97706"}}>✏️ طلب تعديل بند (تخطيط بديل)</span>
   <button onClick={()=>setEditModal(null)} style={{background:"none",border:"none",color:"#5B7A9E",fontSize:22,cursor:"pointer"}}>✕</button>
   </div>
   <div style={{fontSize:11,color:"#5B7A9E",marginBottom:14,background:"#F4F9FE",borderRadius:8,padding:"10px 12px",lineHeight:1.7}}>
   يُسمح بطلب تعديل بند واحد كتخطيط بديل لأحد الدورات سنوياً. سيُرسَل الطلب لمدير الفرع للموافقة، وبعدها تظهر الموافقة لك وللموظف.
   </div>
   <TeamEditRequestForm emp={editModal.emp} rows={editModal.rows} onSubmit={(payload)=>{onRequestEdit(editModal.emp.id,payload);setEditModal(null);}} onCancel={()=>setEditModal(null)}/>
  </div>
  </div>
   )}
  </div>
  );
}

function TeamEditRequestForm({ emp, rows, onSubmit, onCancel }) {
  const [rowId,setRowId] = useState(rows[0]?.id||"");
  const [reason,setReason] = useState("");
  const [altName,setAltName] = useState("");
  const iS={width:"100%",padding:"9px 11px",background:"#F4F9FE",border:"1px solid #C7DBF0",borderRadius:8,color:"#1E293B",fontSize:12,boxSizing:"border-box"};
  const lS={display:"block",fontSize:11,color:"#5B7A9E",marginBottom:5,fontWeight:700};
  const selectedRow = rows.find(r=>r.id===rowId);
  return(
  <div style={{display:"flex",flexDirection:"column",gap:12}}>
   <div>
  <label style={lS}>البند المراد استبداله</label>
  <select value={rowId} onChange={e=>setRowId(e.target.value)} style={iS}>
  {rows.map((r,i)=><option key={r.id} value={r.id}>{r.cat?`[${r.cat}] `:""}{r.programName||r.comp||`بند ${i+1}`}</option>)}
  </select>
   </div>
   {selectedRow&&<div style={{fontSize:10,color:"#5B7A9E",background:"#F4F9FE",borderRadius:8,padding:"8px 12px"}}>الحالي: {selectedRow.programName||"—"} • {selectedRow.provider||"—"}</div>}
   <div>
  <label style={lS}>البديل المقترح (اسم الدورة/البرنامج)</label>
  <input value={altName} onChange={e=>setAltName(e.target.value)} placeholder="اسم الدورة البديلة..." style={iS}/>
   </div>
   <div>
  <label style={lS}>سبب طلب التعديل</label>
  <textarea value={reason} onChange={e=>setReason(e.target.value)} rows={3} placeholder="وضّح سبب الحاجة للتخطيط البديل..." style={{...iS,resize:"vertical"}}/>
   </div>
   <div style={{display:"flex",gap:10,marginTop:4}}>
  <button onClick={onCancel} style={{flex:1,padding:"11px",borderRadius:10,border:"1px solid #C7DBF0",background:"transparent",color:"#5B7A9E",cursor:"pointer"}}>إلغاء</button>
  <button onClick={()=>altName.trim()&&onSubmit({rowId,reason,altName,oldName:selectedRow?.programName||""})} disabled={!altName.trim()}
  style={{flex:2,padding:"11px",borderRadius:10,border:"none",background:altName.trim()?"linear-gradient(135deg,#D97706,#F59E0B)":"#DDE9F5",color:altName.trim()?"#fff":"#334155",fontWeight:700,cursor:altName.trim()?"pointer":"default"}}>📤 إرسال الطلب لمدير الفرع</button>
   </div>
  </div>
  );
}

// مكوّن قابل لإعادة الاستخدام: اعتماد خطط القياديين التابعين (د-7)
// يعرض من يعتمد المستخدمُ الحاليُّ خططَهم (عبر getPlanApprover) مع عرض/اعتماد.
function LeaderPlanApprovals({ user, users, idps, impactData, readings, onApprovePlan, onOpenCard }) {
  // القياديون الذين المستخدم الحالي هو معتمِد خططهم
  const pending = (users||[]).filter(t=>{
    if (t.id===user.id) return false;
    if (getEvalModel(t)!=="leader" && t.role!=="branch_ext" && t.role!=="specialist") return false;
    const approver = getPlanApprover(t, users);
    return approver && approver.id===user.id && idps[t.id]?.plan?.length && idps[t.id]?.isFinal;
  });
  if (!pending.length) return null;
  return (
  <div style={{background:"#FFFFFF",border:"1px solid #8B5CF625",borderRadius:14,padding:16,marginTop:14}}>
   <div style={{fontSize:13,color:"#7C3AED",fontWeight:800,marginBottom:10}}>🏛️ قيادات الفرع — اعتماد خطط التطوّر المهني للقياديين التابعين</div>
   {pending.map(t=>{
   const idp = idps[t.id]; const approved = idp?.approved;
   return (
   <div key={t.id} style={{background:"#F4F9FE",border:`1px solid ${approved?"#10B98130":"#DDE9F5"}`,borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
   <div style={{flex:1}}>
   <div style={{fontWeight:700,fontSize:12,color:"#1E293B"}}>{t.name}</div>
   <div style={{fontSize:11,color:"#5B7A9E"}}>{ROLES_LIST[t.role]}{t.roleSubtype&&ROLE_SUBTYPES[t.role]?` • ${ROLE_SUBTYPES[t.role][t.roleSubtype]||""}`:""} • {idp.plan.length} بند</div>
   {approved&&<div style={{fontSize:10,color:"#059669",marginTop:2}}>✅ معتمدة — {idp.approvedAt}</div>}
   </div>
   <button onClick={()=>onOpenCard(t)} style={{padding:"6px 12px",borderRadius:8,border:"1px solid #3B82F630",background:"#3B82F612",color:"#3B82F6",fontSize:11,cursor:"pointer",fontWeight:700}}>عرض</button>
   {approved
   ? <button onClick={()=>onApprovePlan(t.id,false)} style={{padding:"6px 12px",borderRadius:8,border:"1px solid #EF444430",background:"#EF444410",color:"#EF4444",fontSize:11,cursor:"pointer",fontWeight:700}}>↩ إلغاء</button>
   : <button onClick={()=>onApprovePlan(t.id,true)} style={{padding:"6px 14px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#059669,#10B981)",color:"#fff",fontSize:11,cursor:"pointer",fontWeight:700}}>✅ اعتماد</button>}
   </div>
   );
   })}
  </div>
  );
}

// مكوّن قابل لإعادة الاستخدام: تبويبا "خطتي المهنية" و"تقييم أدائي" للمديرين (د-7)
// ساعات الخطة للمديرين = 15. التقييم يستخدم نموذج الدور تلقائياً (د-4).
function MyPlanAndEval({ user, idps, evals, impactData, readings, locks, setLocks, onSaveIdp, onSaveSelfEval, onSaveReadings, showToast, evalWinData = {branches:{}} }) {
  const [subTab,setSubTab] = useState("plan"); // plan | eval
  const [cardOpen,setCardOpen] = useState(false);
  const [selfTarget,setSelfTarget] = useState(null);
  const myEmpEval = evals[user.id]||{};
  const st360 = getEmpFullStats(user, myEmpEval);
  const selfDone = Object.keys(myEmpEval.self||{}).length>0;
  const selfLocked = locks && locks[`${user.id}__self`];

  return (
  <div>
   <div style={{display:"flex",gap:6,marginBottom:16}}>
   {[{k:"plan",l:"🎯 خطتي المهنية",c:"#8B5CF6"},{k:"eval",l:"📊 تقييم أدائي",c:"#F59E0B"}].map(t=>(
   <button key={t.k} onClick={()=>setSubTab(t.k)} style={{flex:1,padding:"11px",borderRadius:12,border:"none",background:subTab===t.k?`linear-gradient(135deg,${t.c},${t.c}cc)`:"#fff",color:subTab===t.k?"#fff":"#5B7A9E",fontSize:13,fontWeight:800,cursor:"pointer",boxShadow:subTab===t.k?`0 6px 18px ${t.c}40`:"0 2px 8px rgba(46,127,184,0.07)"}}>{t.l}</button>
   ))}
   </div>

   {subTab==="plan"&&(
   <div>
   {(()=>{
   const key = user.roleSubtype?`${user.role}/${user.roleSubtype}`:user.role;
   const label = PLAN_APPROVER_LABEL[key]||PLAN_APPROVER_LABEL[user.role];
   const myIdp = idps[user.id];
   const approved = myIdp?.approved;
   return label?(
   <div style={{background:approved?"#10B98110":"#8B5CF60D",border:`1px solid ${approved?"#10B98130":"#8B5CF625"}`,borderRadius:12,padding:"11px 16px",marginBottom:14,display:"flex",alignItems:"center",gap:10}}>
   <span style={{fontSize:18}}>{approved?"✅":"📋"}</span>
   <div style={{fontSize:12,color:"#5B7A9E",lineHeight:1.6}}>
   {approved?<span style={{color:"#059669",fontWeight:700}}>خطتك معتمدة.</span>:<>خطتك تُعتمد من: <strong style={{color:"#7C3AED"}}>{label}</strong>.</>}
   <span style={{color:"#8CA3BD"}}> • الحدّ الأدنى 15 ساعة.</span>
   </div>
   </div>
   ):null;
   })()}
   <EmployeeGrowthPlan user={user} empEval={myEmpEval} idpData={idps[user.id]} onSave={onSaveIdp} viewerRole="employee" impactData={impactData} minHours={15}/>
   </div>
   )}

   {subTab==="eval"&&(
   <div>
   <div style={{background:"#FFFFFF",border:"1px solid #F59E0B25",borderRadius:12,padding:"14px 18px",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
   <div>
   <div style={{fontSize:14,fontWeight:900,color:"#D97706"}}>📊 تقييم أدائي الوظيفي</div>
   <div style={{fontSize:11,color:"#5B7A9E",marginTop:2}}>تقييمك من الأطراف حسب نموذج وظيفتك</div>
   </div>
   <button onClick={()=>setCardOpen(true)} style={{padding:"8px 16px",borderRadius:10,border:"1px solid #F59E0B40",background:"#F59E0B12",color:"#D97706",fontSize:12,fontWeight:700,cursor:"pointer"}}>📋 عرض بطاقتي الكاملة</button>
   </div>
   <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:12}}>
   {EVAL_PARTIES.map(p=>{
   const ps=st360?.partyScores?.[p.key]; if(!ps) return null;
   const lv=getLevel(ps.avg); const pct=(ps.avg/5)*ps.weight;
   return(
   <div key={p.key} style={{flex:1,minWidth:120,background:"#FFFFFF",border:`1px solid ${p.color}25`,borderRadius:12,padding:"12px",textAlign:"center"}}>
   <div style={{fontSize:11,color:p.color,fontWeight:700,marginBottom:4}}>{p.icon} {p.label}</div>
   <div style={{fontSize:18,fontWeight:900,color:lv.color,fontFamily:MONO}}>{ps.avg.toFixed(2)}</div>
   <div style={{fontSize:9,color:"#8CA3BD",marginTop:2}}>{pct.toFixed(1)}% من {ps.weight}%</div>
   </div>
   );
   })}
   </div>
   {(()=>{
   const winSt = branchWindowStatus(evalWinData, user.branch);
   if (selfLocked) return <div style={{padding:"12px",borderRadius:12,background:"#EF444410",border:"2px solid #EF444430",color:"#EF4444",fontWeight:700,fontSize:13,textAlign:"center"}}>🔒 التقييم الذاتي مقفول</div>;
   return (<>
   <div style={{marginBottom:8,textAlign:"center"}}><span style={{fontSize:11,color:winSt.color,background:`${winSt.color}12`,padding:"3px 12px",borderRadius:12,fontWeight:700}}>{winSt.icon} حالة تقييم فرعك: {winSt.label}</span></div>
   {winSt.open
   ? <button onClick={()=>setSelfTarget(user)} style={{width:"100%",padding:"12px",borderRadius:12,border:selfDone?"1px solid #10B98140":"none",background:selfDone?"#10B98115":"linear-gradient(135deg,#059669,#10B981)",color:selfDone?"#10B981":"#fff",fontWeight:700,fontSize:13,cursor:"pointer"}}>{selfDone?"✏️ تعديل تقييمي الذاتي":"📝 ابدأ تقييمي الذاتي"}</button>
   : <div style={{padding:"12px",borderRadius:12,background:"#F1F5F9",border:"2px solid #E2E8F0",color:"#94A3B8",fontWeight:700,fontSize:13,textAlign:"center"}}>🔒 التقييم مغلق — لا يمكن {selfDone?"التعديل":"البدء"}</div>}
   </>);
   })()}
   </div>
   )}

   {cardOpen&&<Card360 targetUser={user} empEval={myEmpEval} idpData={idps[user.id]} readings={readings} onSaveReadings={onSaveReadings} currentUser={user} hidePrint onClose={()=>setCardOpen(false)} allUsers={[]}/>}
   {selfTarget&&<EvalForm partyKey="self" targetUser={user} existingScores={myEmpEval.self||{}} onSave={async s=>{await onSaveSelfEval(s);setSelfTarget(null);}} onCancel={()=>setSelfTarget(null)} locks={locks} onLock={async(key)=>{const nl={...(locks||{}),[key]:{lockedAt:new Date().toISOString()}};setLocks(nl);await st.set('locks_360c',nl);}}/>}
  </div>
  );
}

function StageManagerPanel({ user, onLogout }) {
  const [tab,setTab] = useState("growth"); // growth | eval
  const [evalWinData,setEvalWinData] = useState({branches:{}});
  const [users,setUsersState] = useState([]);
  const [evals,setEvalsState] = useState({});
  const [idps,setIdpsState] = useState({});
  const [readings,setReadings] = useState({});
  const [locks,setLocks] = useState({});
  const [approvals,setApprovals] = useState({});
  const [impactData,setImpactData] = useState({});
  const [evalTarget,setEvalTarget] = useState(null);
  const [viewTarget,setViewTarget] = useState(null);
  const [twiceList,setTwiceList] = useState([]); // ب-4: ترشيح للتقييم الثاني
  const [toast,setToast] = useState(null);
  const showToast = (msg,c="#10B981") => { setToast({msg,c}); setTimeout(()=>setToast(null),2000); };
  const toggleTwice = async (targetId) => {
  const nt = twiceList.includes(targetId) ? twiceList.filter(x=>x!==targetId) : [...twiceList,targetId];
  setTwiceList(nt); await st.set("twiceeval_360c",nt); showToast(nt.includes(targetId)?"🔁 رُشّح للتقييم الثاني":"أُلغي الترشيح");
  };
  // هل للموظف متابع فني؟ (إن لا، فمدير المرحلة هو من يرشّح)
  const hasSupervisor = (u) => (users||[]).some(s=>s.role==="supervisor" && getEvaluators(u,users).some(e=>e.id===s.id));

  useEffect(()=>{
  const loadData = ()=>{
  st.get("users_360c").then(u=>setUsersState(u||[]));
  st.get("evalwindow_360c").then(w=>setEvalWinData(w||{branches:{}}));
  st.get("evals_360c").then(d=>setEvalsState(d||{}));
  st.get("idps_360c").then(d=>setIdpsState(d||{}));
  st.get("readings_360c").then(d=>setReadings(d||{}));
  st.get("locks_360c").then(d=>setLocks(d||{}));
  st.get("approvals_360c").then(d=>setApprovals(d||{}));
  st.get("impact_360c").then(d=>setImpactData(d||{}));
  Promise.all([st.get("round2_360c"),st.get("twiceeval_360c")]).then(([r2,tw])=>{setRound2Ctx(r2?.open,tw||[]);setTwiceList(tw||[]);}); // ب-4
  st.getShared("customComps_360c").then(d=>{ if(d){ setActiveComps(d); COMPETENCIES_WITH_ITEMS=d; } });
  st.getShared("profCerts_360c").then(d=>{ if(d&&d.length){ setProfCerts(d); } });
  st.getShared("customJobs_360c").then(d=>{ if(d){ setActiveJobs(d); JOB_COMPETENCIES=d; } });
  st.getShared("customWeights_360c").then(d=>{ if(d){ setActiveWeights(d); if(d.employee||d.leader||d.specialist||d.branch_ext) applyCustomWeights(d); else applyCustomWeights({employee:d}); } });
  st.getShared("customSources_360c").then(d=>{ if(d){ setActiveSources(d); } });
  st.getShared("customSourceMap_360c").then(d=>{ if(d){ setActiveCompMap(d); } });
  };
  loadData();
  setTimeout(()=>setUsersState(u=>[...u]), 300);
  // تحديث شبه لحظي عند النشر: عند عودة التركيز للصفحة + كل 25 ثانية
  const onFocus = ()=>loadData();
  window.addEventListener("focus", onFocus);
  const iv = setInterval(loadData, 25000);
  return ()=>{ window.removeEventListener("focus", onFocus); clearInterval(iv); };
  },[]);

  const myStages = scopeStages(user);
  const myTargets = (users||[]).filter(u=>u.role==="employee" && u.branch===user.branch && myStages.includes(u.stage));
  const partyKey = "stage_mgr";
  const allowedCats = PARTY_CATS[partyKey]||[];
  const party = EVAL_PARTIES.find(p=>p.key===partyKey);

  const saveEval = async (targetId, scores) => {
  const ne = {...evals};
  if (!ne[targetId]) ne[targetId]={};
  ne[targetId] = {...ne[targetId]};
  writePartyScore(ne[targetId], partyKey, scores, targetId);
  setEvalsState(ne); await st.set("evals_360c",ne);
  setEvalTarget(null); showToast(isR2Active(targetId)?"✓ حُفظ (التقييم الثاني)":"✓ تم حفظ التقييم");
  };

  const growthStats = useMemo(()=>{
  let totalPlans=0, approved=0, totalRows=0, doneRows=0, inProgRows=0;
  let totalHours=0, totalCost=0, approvedRows=0, impactMeasured=0;
  myTargets.forEach(u=>{
   const p = idps[u.id];
   if (p?.plan?.length){ totalPlans++; if(p.approved) approved++;
  p.plan.forEach(r=>{ totalRows++;
  if(r.status==="تم التنفيذ") doneRows++;
  else if(r.status==="جاري التنفيذ") inProgRows++;
  const h=parseFloat(String(r.hours||"").replace(/[^\d.]/g,"")); if(!isNaN(h))totalHours+=h;
  const c=parseFloat(String(r.cost||"").replace(/[^\d.]/g,"")); if(!isNaN(c))totalCost+=c;
  if(p.approved){ approvedRows++;
   const im=impactData[`${u.id}__${r.id}`];
   if(im&&im.scores&&Object.keys(im.scores).length>0) impactMeasured++;
  }
  });
   }
  });
  const execPct = totalRows? Math.round((doneRows+inProgRows*0.5)/totalRows*100):0;
  return { totalPlans, approved, totalRows, doneRows, inProgRows, execPct, totalHours, totalCost,
   impactPct: approvedRows?Math.round((impactMeasured/approvedRows)*100):0, impactMeasured, approvedRows };
  },[myTargets, idps]);

  const statusColor = { "تم التنفيذ":"#10B981", "جاري التنفيذ":"#F59E0B", "لم يتم التنفيذ":"#EF4444" };

  // د-7: دوال الخطة والاعتماد الشخصية لمدير المرحلة (كانت مفقودة → اللوحة لا تفتح)
  const saveMyIdp = async (d) => { const ni={...idps,[user.id]:d}; setIdpsState(ni); await st.set("idps_360c",ni); showToast("✓ تم حفظ خطتك"); };
  const saveMySelfEval = async (scores) => { const ne={...evals}; if(!ne[user.id])ne[user.id]={}; ne[user.id].self=scores; setEvalsState(ne); await st.set("evals_360c",ne); showToast("✓ تم حفظ تقييمك الذاتي"); };
  const approveLeaderPlan = async (targetId, approve) => {
  const cur = idps[targetId]||{};
  const ni = {...idps,[targetId]:{...cur, approved:approve, approvedBy:approve?user.name:null, approvedAt:approve?new Date().toISOString().split("T")[0]:null}};
  setIdpsState(ni); await st.set("idps_360c",ni);
  showToast(approve?"✅ اعتُمدت خطة القيادي":"↩ أُلغي الاعتماد");
  };

  return (
  <div style={{minHeight:"100vh",background:APP_BG,fontFamily:"'El Messiri',sans-serif",direction:"rtl",color:"#1E293B"}}>
   {toast&&<div style={{position:"fixed",top:18,left:"50%",transform:"translateX(-50%)",background:toast.c,color:"#fff",padding:"11px 26px",borderRadius:30,fontWeight:700,fontSize:13,zIndex:9999,boxShadow:`0 8px 28px ${toast.c}55`,animation:"fadeInUp 0.3s ease"}}>{toast.msg}</div>}

   <header style={{background:"rgba(255,255,255,0.82)",backdropFilter:"blur(14px)",borderBottom:"1px solid #C7DBF0",padding:"0 20px",position:"sticky",top:0,zIndex:100,boxShadow:"0 4px 18px rgba(46,127,184,0.08)"}}>
  <div style={{maxWidth:1000,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",height:54}}>
  <div style={{display:"flex",alignItems:"center",gap:10}}>
   <LogoImg style={{height:32}} size={15}/>
   <div><div style={{fontWeight:900,fontSize:15,color:"#15385C",letterSpacing:"-0.3px"}}>متابعة {myStages.length>1?"المراحل":"المرحلة"}</div><div style={{fontSize:10,color:"#5B7A9E"}}>{user.name} • 📚 {myStages.join(" • ")||"—"}{user.branch?` • 🏛️ ${user.branch}`:""}</div></div>
  </div>
  <div style={{display:"flex",gap:6}}>
   <PrintButton title={`تقرير المرحلة - ${user.name}`} branch={user.branch}/>
   <ChangePasswordButton userId={user.id} currentPassword={user.password}/>
   <RefreshButton/><button onClick={onLogout} style={{padding:"5px 12px",borderRadius:20,border:"1px solid #EF444430",background:"#EF444410",color:"#EF4444",fontSize:11,cursor:"pointer",marginRight:6}}>خروج</button>
  </div>
  </div>
   </header>

   <main className="print-area" style={{maxWidth:1000,margin:"0 auto",padding:"20px 16px"}}>
  {/* التبويبان */}
  <div style={{display:"flex",gap:8,marginBottom:18}}>
  {[{k:"growth",l:"👥 متابعة التطور المهني",c:"#10B981"},{k:"eval",l:"📋 متابعة تقييم الأداء",c:"#3B82F6"},{k:"mine",l:"🎯 خطتي وتقييمي",c:"#8B5CF6"}].map(t=>(
   <button key={t.k} onClick={()=>setTab(t.k)}
   style={{flex:1,padding:"13px 18px",borderRadius:24,border:"none",background:tab===t.k?`linear-gradient(135deg,${t.c},${t.c}cc)`:"#fff",color:tab===t.k?"#fff":"#5B7A9E",fontSize:14,fontWeight:800,cursor:"pointer",boxShadow:tab===t.k?`0 8px 22px ${t.c}45`:"0 2px 10px rgba(46,127,184,0.08)"}}>
   {t.l}
   </button>
  ))}
  </div>

  {myTargets.length===0&&(
  <div style={{textAlign:"center",padding:60,color:"#8CA3BD"}}>
   <div style={{fontSize:40,marginBottom:12}}>👥</div>
   لا يوجد موظفون في مرحلتك
   {(!myStages.length||!user.branch)
   ? <div style={{fontSize:12,marginTop:10,color:"#F59E0B",background:"#F59E0B12",borderRadius:10,padding:"10px 16px",display:"inline-block"}}>⚠️ حسابك غير مكتمل: يجب تحديد {!myStages.length?"المراحل التابعة لك":""}{(!myStages.length&&!user.branch)?" و":""}{!user.branch?"الفرع":""} من لوحة مدير النظام</div>
   : <div style={{fontSize:11,marginTop:8}}>يظهر هنا موظفو {myStages.length>1?"مراحل":"مرحلة"} «{myStages.join(" • ")}» في فرع «{user.branch}»</div>}
  </div>
  )}

  {/* ═══ التبويب 1: متابعة التطور المهني ═══ */}
  {tab==="growth"&&(
  <LeaderPlanApprovals user={user} users={users} idps={idps} impactData={impactData} readings={readings}
   onApprovePlan={approveLeaderPlan} onOpenCard={(t)=>setViewTarget(t)}/>
  )}
  {tab==="growth"&&myTargets.length>0&&(
  <div>
   {/* لوحة إحصاءات المرحلة */}
   <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
   {[
  {l:"👥 الموظفون",v:myTargets.length,c:"#2E7FB8"},
  {l:"📋 خطط معتمدة",v:`${growthStats.approved}/${growthStats.totalPlans}`,c:"#10B981"},
  {l:"⏱️ إجمالي الساعات",v:growthStats.totalHours%1===0?growthStats.totalHours:growthStats.totalHours.toFixed(1),c:"#0891B2"},
  {l:"💰 إجمالي التكلفة",v:growthStats.totalCost>0?growthStats.totalCost.toLocaleString("en-US"):"0",c:"#D97706"},
  {l:"📊 نسبة التنفيذ",v:`${growthStats.execPct}%`,c:"#059669"},
   {l:"📏 قياس الأثر",v:`${growthStats.impactPct}%`,c:"#8B5CF6"},
   ].map((card,i)=>(
  <div key={i} style={{flex:1,minWidth:120,background:BRAND.cardBg,border:`1px solid ${BRAND.cardBorder}`,borderRadius:20,padding:"16px 18px",boxShadow:"0 8px 26px rgba(46,127,184,0.10)"}}>
  <div style={{fontSize:11,color:card.c,fontWeight:700,marginBottom:4}}>{card.l}</div>
  <div style={{fontSize:22,fontWeight:900,color:"#15385C",fontFamily:MONO}}>{card.v}</div>
  </div>
   ))}
   </div>

   <div style={{background:"#10B9810D",border:"1px solid #10B98130",borderRadius:12,padding:"12px 16px",marginBottom:14,fontSize:12,color:"#5B7A9E",lineHeight:1.7}}>
   👁️ متابعة خطط التطور المهني لموظفي مرحلتك (تخطيط • تنفيذ • قياس الأثر) — للاطّلاع والمتابعة فقط دون تدخّل.
   </div>

   {/* بطاقات الموظفين مع خططهم */}
   {myTargets.map(u=>{
   const plan = idps[u.id]||{};
   const rows = plan.plan||[];
   const approved = plan.approved;
   const doneCount = rows.filter(r=>r.status==="تم التنفيذ").length;
   const pct = rows.length? Math.round((doneCount + rows.filter(r=>r.status==="جاري التنفيذ").length*0.5)/rows.length*100):0;
   return(
  <details key={u.id} style={{background:BRAND.cardBg,border:`1px solid ${approved?"#10B98125":BRAND.cardBorder}`,borderRadius:20,marginBottom:12,overflow:"hidden",boxShadow:"0 8px 26px rgba(46,127,184,0.10)"}}>
  <summary style={{padding:"14px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:12,listStyle:"none"}}>
  <div style={{width:38,height:38,borderRadius:10,background:approved?"#10B98115":"#F4F9FE",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,flexShrink:0}}>{approved?"✅":"🎯"}</div>
  <div style={{flex:1,minWidth:0}}>
  <div style={{fontWeight:700,fontSize:13,color:"#15385C"}}>{u.name}</div>
  <div style={{fontSize:11,color:"#8CA3BD"}}>{u.job} • {rows.length} بند{approved?` • تنفيذ ${pct}%`:""}</div>
  </div>
  {approved
  ? <span style={{fontSize:10,color:"#10B981",background:"#10B98115",padding:"3px 10px",borderRadius:20,fontWeight:700}}>معتمدة من الفني</span>
  : <span style={{fontSize:10,color:"#F59E0B",background:"#F59E0B15",padding:"3px 10px",borderRadius:20,fontWeight:700}}>غير معتمدة</span>}
  </summary>
  <div style={{padding:"0 16px 16px",borderTop:"1px solid #DDE9F5"}}>
  {rows.length===0?(
  <div style={{textAlign:"center",padding:20,color:"#8CA3BD",fontSize:12}}>لم يضع الموظف خطته بعد</div>
  ):rows.map((r,i)=>{
  const sc = statusColor[r.status]||"#8CA3BD";
  return(
   <div key={r.id} style={{background:"#F4F9FE",border:`1px solid ${sc}25`,borderRadius:10,padding:"10px 14px",marginTop:8}}>
   <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
   <div style={{flex:1,minWidth:0}}>
   <div style={{fontSize:12,color:"#15385C",fontWeight:700}}>{r.cat?`[${r.cat}] `:""}{r.programName||r.comp||`بند ${i+1}`}</div>
   <div style={{fontSize:10,color:"#8CA3BD",marginTop:2}}>{r.provider||"—"}{r.hours?` • ${r.hours}س`:""}{r.cost?` • ${r.cost}`:""}{r.targetDate?` • 📅 ${r.targetDate}`:""}</div>
   </div>
   <span style={{fontSize:10,color:sc,background:`${sc}15`,padding:"3px 10px",borderRadius:20,fontWeight:700}}>{r.status||"لم يتم التنفيذ"}</span>
   </div>
   {r.status==="تم التنفيذ"&&r.evalMethod&&<ImpactMeasure row={r} impact={impactData[`${u.id}__${r.id}`]} editable={false} onSave={()=>{}}/>}
   </div>
  );
  })}
  </div>
  </details>
   );
   })}
  </div>
  )}

  {/* ═══ التبويب 2: متابعة تقييم الأداء ═══ */}
  {tab==="eval"&&myTargets.length>0&&(
  <div>
   {(()=>{
   const okPairs = myStages.filter(s=>approvals[`${user.branch}__${s}__eval`]?.approved);
   if(!okPairs.length) return null;
   return(
   <div style={{background:"#10B98112",border:"1px solid #10B98140",borderRadius:12,padding:"12px 16px",marginBottom:14,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
  <span style={{fontSize:22}}>✅</span>
  <div style={{flex:1,minWidth:200}}><div style={{fontSize:13,fontWeight:900,color:"#10B981"}}>نتائج تقييم معتمدة من مدير الفرع</div><div style={{fontSize:10,color:"#5B7A9E",marginTop:2}}>بدأت قراءة النتائج لـ: {okPairs.join(" • ")}</div></div>
   </div>
   );})()}
   {/* توضيح الدور */}
   <div style={{background:BRAND.cardBg,border:`1px solid ${party.color}20`,borderRadius:12,padding:"12px 16px",marginBottom:14,boxShadow:BRAND.softShadow}}>
   <div style={{fontSize:12,color:"#5B7A9E",marginBottom:8}}>دورك: تقييم موظفي مرحلتك كمدير مباشر</div>
   <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
  {allowedCats.map(cat=>(
  <div key={cat} style={{background:`${CAT_COLORS[cat]}15`,border:`1px solid ${CAT_COLORS[cat]}25`,borderRadius:8,padding:"6px 14px"}}>
  <span style={{color:CAT_COLORS[cat],fontSize:12,fontWeight:700}}>{cat}</span>
  <span style={{fontSize:11,color:"#5B7A9E",marginRight:8}}>← وزن <strong style={{color:party.color,fontFamily:MONO}}>{PARTY_CAT_WEIGHTS[partyKey][cat]}%</strong></span>
  </div>
  ))}
   </div>
   </div>

   {/* لوحة حالة التقييم لكل مرحلة */}
   {myStages.map(stg=>{
  const stEmps = myTargets.filter(u=>u.stage===stg);
  if(!stEmps.length) return null;
  return(
  <div key={stg} style={{background:BRAND.cardBg,border:`1px solid ${BRAND.cardBorder}`,borderRadius:20,marginBottom:14,padding:16,boxShadow:"0 8px 26px rgba(46,127,184,0.10)"}}>
   <div style={{fontSize:13,fontWeight:900,color:"#15385C",marginBottom:12}}>📋 حالة تقييم الأداء — {stg}</div>
   <EvalStatusBoard emps={stEmps} evals={evals} locks={locks}/>
  </div>
  );
   })}

   {/* تحليل التقييمات (تقرير قابل للطباعة) */}
   <details style={{background:BRAND.cardBg,border:`1px solid ${BRAND.cardBorder}`,borderRadius:20,marginBottom:14,overflow:"hidden",boxShadow:"0 8px 26px rgba(46,127,184,0.10)"}}>
   <summary style={{padding:"14px 16px",cursor:"pointer",fontSize:13,fontWeight:800,color:"#2E7FB8",listStyle:"none"}}>📑 تحليل تقييمات موظفي مرحلتي (اضغط للعرض)</summary>
   <div style={{padding:"0 16px 16px"}}>
  <AggregateReport users={myTargets} evals={evals} currentUser={user} restrictBranch/>
   </div>
   </details>

   {/* قائمة الموظفين للتقييم */}
   {myTargets.map(u=>{
   const empEval = evals[u.id]||{};
   const myEval = empEval[partyKey]||{};
   const myComps = (getActiveJobs()[u.job]||[]).filter(c=>allowedCats.includes(getCat(c)));
   const scoredItems = myComps.reduce((s,c)=>{
  const items=getActiveComps()[c]?.items||[];
  return s+items.filter((_,i)=>(myEval[c]?.[i]||0)>0).length;
   },0);
   const totalItems = myComps.reduce((s,c)=>(getActiveComps()[c]?.items?.length||0)+s,0);
   const done = scoredItems>0;
   const lk = locks[`${u.id}__${partyKey}`];
   const winSt = branchWindowStatus(evalWinData, u.branch);
   return(
  <div key={u.id} style={{background:BRAND.cardBg,border:`1px solid ${done?party.color+"25":BRAND.cardBorder}`,borderRadius:18,padding:"15px 18px",display:"flex",alignItems:"center",gap:12,marginBottom:8,flexWrap:"wrap",boxShadow:"0 6px 20px rgba(46,127,184,0.08)"}}>
  <div style={{width:40,height:40,borderRadius:10,background:done?`${party.color}15`:"#F4F9FE",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{done?"✅":"👤"}</div>
  <div style={{flex:1,minWidth:140}}>
  <div style={{fontWeight:700,fontSize:13,color:"#15385C"}}>{u.name}</div>
  <div style={{fontSize:11,color:"#8CA3BD"}}>{u.job}{done?` • ✓ ${scoredItems}/${totalItems} بند`:""}</div>
  <div style={{marginTop:3}}><span style={{fontSize:9,color:winSt.color,background:`${winSt.color}12`,padding:"1px 7px",borderRadius:10,fontWeight:700}}>{winSt.icon} التقييم {winSt.label}</span></div>
  </div>
  <div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}>
  {/* ب-4: ترشيح للتقييم الثاني — فقط لمن لا متابع فني له، وبعد اعتماد التقييم الأول */}
  {!hasSupervisor(u)&&approvals[`${user.branch}__${u.stage}__eval`]?.approved&&(
  <button onClick={()=>toggleTwice(u.id)} title="ترشيح للتقييم الثاني (فرصة تحسين)"
  style={{padding:"6px 10px",borderRadius:8,border:`1px solid ${twiceList.includes(u.id)?"#F59E0B60":"#DDE9F5"}`,background:twiceList.includes(u.id)?"#F59E0B15":"transparent",color:twiceList.includes(u.id)?"#F59E0B":"#5B7A9E",fontSize:11,cursor:"pointer",fontWeight:twiceList.includes(u.id)?700:400}}>
  {twiceList.includes(u.id)?"🔁 مرشَّح":"🔁 ترشيح"}
  </button>
  )}
  <button onClick={()=>setViewTarget(u)} style={{padding:"6px 12px",borderRadius:8,border:"1px solid #C7DBF0",background:"transparent",color:"#5B7A9E",fontSize:11,cursor:"pointer"}}>عرض</button>
  {lk
  ? <div style={{padding:"6px 12px",borderRadius:8,background:"#EF444410",border:"1px solid #EF444430",color:"#EF4444",fontSize:11,fontWeight:700}}>🔒 مقفول</div>
  : (!winSt.open&&!done)
  ? <div style={{padding:"6px 12px",borderRadius:8,background:"#F1F5F9",border:"1px solid #E2E8F0",color:"#94A3B8",fontSize:11,fontWeight:700}} title="نافذة تقييم الفرع مغلقة">🔒 التقييم مغلق</div>
  : <button onClick={()=>setEvalTarget(u)} style={{padding:"7px 16px",borderRadius:8,border:done?`1.5px solid ${party.color}`:"none",background:done?"#fff":`linear-gradient(135deg,${party.color}cc,${party.color})`,color:done?party.color:"#fff",fontSize:12,cursor:"pointer",fontWeight:800}}>{done?"✏️ تعديل":"📝 تقييم ▶"}</button>}
  </div>
  </div>
   );
   })}
  </div>
  )}

  {/* ═══ التبويب 3: خطتي وتقييمي (د-7) ═══ */}
  {tab==="mine"&&(
  <MyPlanAndEval user={user} idps={idps} evals={evals} impactData={impactData} readings={readings} locks={locks} setLocks={setLocks} evalWinData={evalWinData}
   onSaveIdp={saveMyIdp} onSaveSelfEval={saveMySelfEval} onSaveReadings={async d=>{setReadings(d);await st.set("readings_360c",d);}} showToast={showToast}/>
  )}
   </main>

   {viewTarget&&<Card360 targetUser={viewTarget} empEval={evals[viewTarget.id]||{}} idpData={idps[viewTarget.id]} readings={readings} onSaveReadings={async d=>{setReadings(d);await st.set("readings_360c",d);}} currentUser={user} allEvals={evals} allUsers={users} approvals={approvals} onClose={()=>setViewTarget(null)}/>}
   {evalTarget&&<EvalForm partyKey={partyKey} targetUser={evalTarget} existingScores={readPartyScore(evals[evalTarget.id]||{},partyKey,evalTarget.id)} onSave={scores=>saveEval(evalTarget.id,scores)} onCancel={()=>setEvalTarget(null)} locks={locks} onLock={async(key)=>{const nl={...(locks||{}),[key]:{lockedAt:new Date().toISOString()}};setLocks(nl);await st.set('locks_360c',nl);}}/>}
  </div>
  );
}

function EvaluatorPanel({ user, partyKey, onLogout }) {
  const [supTab,setSupTab] = useState("team_growth"); // my_growth | my_eval | team_growth | team_eval
  const [evalWinData,setEvalWinData] = useState({branches:{}});
  const [users,setUsersState] = useState([]);
  const [evals,setEvalsState] = useState({});
  const [idps,setIdpsState] = useState({});
  const [evalTarget,setEvalTarget] = useState(null);
  const [viewTarget,setViewTarget] = useState(null);
  const [planTarget,setPlanTarget] = useState(null);
  const [showReport,setShowReport] = useState(false);
  const [readings,setReadings] = useState({});
  const [locks,setLocks] = useState({});
  const [editRequests,setEditRequests] = useState({});
  const [twiceList,setTwiceList] = useState([]);
  const [selfTarget,setSelfTarget] = useState(null);
  const [peerAssign,setPeerAssign] = useState(null);
  const [myCardOpen,setMyCardOpen] = useState(false);
  const [approvals,setApprovals] = useState({});
  const [impactData,setImpactData] = useState({});
  const [toast,setToast] = useState(null);

  const showToast = (msg,c="#10B981") => { setToast({msg,c}); setTimeout(()=>setToast(null),2000); };

  const saveImpact = async (empId,rowId,data) => {
   const ni = {...impactData, [`${empId}__${rowId}`]:data};
   setImpactData(ni); await st.set("impact_360c",ni); showToast("✓ حُفظ قياس الأثر");
  };

  useEffect(()=>{
  const loadData = ()=>{
  st.get("users_360c").then(u=>setUsersState(u||[]));
  st.get("evalwindow_360c").then(w=>setEvalWinData(w||{branches:{}}));
  st.get("evals_360c").then(d=>setEvalsState(d||{}));
  st.get("idps_360c").then(d=>setIdpsState(d||{}));
  st.get("readings_360c").then(d=>setReadings(d||{}));
  st.get("locks_360c").then(d=>setLocks(d||{}));
  st.get("approvals_360c").then(d=>setApprovals(d||{}));
  st.get("impact_360c").then(d=>setImpactData(d||{}));
  st.get("editreq_360c").then(d=>setEditRequests(d||{}));
  st.get("twiceeval_360c").then(d=>setTwiceList(d||[]));
  // ب-4: نضبط سياق الجولة الثانية (مفتوح + المرشّحون)
  Promise.all([st.get("round2_360c"),st.get("twiceeval_360c")]).then(([r2,tw])=>setRound2Ctx(r2?.open,tw||[]));
  st.getShared("customComps_360c").then(d=>{ if(d){ setActiveComps(d); COMPETENCIES_WITH_ITEMS=d; } });
  st.getShared("profCerts_360c").then(d=>{ if(d&&d.length){ setProfCerts(d); } });
  st.getShared("customJobs_360c").then(d=>{ if(d){ setActiveJobs(d); JOB_COMPETENCIES=d; } });
  st.getShared("customWeights_360c").then(d=>{ if(d){ setActiveWeights(d); if(d.employee||d.leader||d.specialist||d.branch_ext) applyCustomWeights(d); else applyCustomWeights({employee:d}); } });
  st.getShared("customSources_360c").then(d=>{ if(d){ setActiveSources(d); } });
  st.getShared("customSourceMap_360c").then(d=>{ if(d){ setActiveCompMap(d); } });
  setTimeout(()=>setUsersState(u=>[...u]), 300);
  };
  loadData();
  const onFocus=()=>loadData();
  window.addEventListener("focus",onFocus);
  const iv=setInterval(loadData,25000);
  return ()=>{ window.removeEventListener("focus",onFocus); clearInterval(iv); };
  },[]);

  const myTargets = (users||[]).filter(u=>{
  if (u.role!=="employee") return false;
  if (partyKey==="supervisor") return u.supervisorId===user.id;
  if (partyKey==="stage_mgr")  return u.stageManagerId===user.id;
  return false;
  });

  const saveEval = async (targetId, scores) => {
  const ne = {...evals};
  if (!ne[targetId]) ne[targetId]={};
  ne[targetId] = {...ne[targetId]};
  writePartyScore(ne[targetId], partyKey, scores, targetId);
  setEvalsState(ne); await st.set("evals_360c",ne);
  setEvalTarget(null); showToast(isR2Active(targetId)?"✓ حُفظ (التقييم الثاني)":"✓ تم حفظ التقييم");
  };

  const assignPeer = async (empId, peerIds) => {
  const nu = (users||[]).map(u=>u.id===empId?{...u,peerIds,peerId:undefined}:u);
  setUsersState(nu);
  try {
   if (typeof window.andlusAPI?.setPeers === "function") { await window.andlusAPI.setPeers(empId, peerIds); }
   else { await st.set("users_360c",nu); }
  } catch(e){ showToast("تعذّر حفظ الزملاء","#EF4444"); }
  setPeerAssign(pa=>pa&&pa.id===empId?{...pa,peerIds}:pa);
  };

  const saveMySelfEval = async (scores) => {
  const ne = {...evals};
  if (!ne[user.id]) ne[user.id]={};
  ne[user.id].self = scores;
  setEvalsState(ne); await st.set("evals_360c",ne);
  setSelfTarget(null); showToast("✓ تم حفظ تقييمك الذاتي");
  };

  const saveTeamIdp = async (targetId, d) => {
  const ni = {...idps,[targetId]:d};
  setIdpsState(ni); await st.set("idps_360c",ni);
  };
  // د-7: اعتماد/إلغاء اعتماد خطة قيادي تابع
  const approveLeaderPlan = async (targetId, approve) => {
  const cur = idps[targetId]||{};
  const ni = {...idps,[targetId]:{...cur, approved:approve, approvedBy:approve?user.name:null, approvedAt:approve?new Date().toISOString().split("T")[0]:null}};
  setIdpsState(ni); await st.set("idps_360c",ni);
  showToast(approve?"✅ اعتُمدت خطة القيادي":"↩ أُلغي الاعتماد");
  };
  const saveMyIdp = async (d) => {
  const ni = {...idps,[user.id]:d};
  setIdpsState(ni); await st.set("idps_360c",ni);
  showToast("✓ تم حفظ خطتك");
  };
  const requestEdit = async (targetId, payload) => {
  const nr = {...editRequests};
  nr[targetId] = { ...payload, requestedBy:user.name, requesterId:user.id, at:new Date().toISOString().split("T")[0], status:"pending", branch:user.branch };
  setEditRequests(nr); await st.set("editreq_360c",nr);
  showToast("✓ أُرسل طلب التعديل لمدير الفرع");
  };
  const toggleTwice = async (targetId) => {
  const nt = twiceList.includes(targetId) ? twiceList.filter(x=>x!==targetId) : [...twiceList,targetId];
  setTwiceList(nt); await st.set("twiceeval_360c",nt);
  };

  const party = EVAL_PARTIES.find(p=>p.key===partyKey);
  const allowedCats = PARTY_CATS[partyKey]||[];
  const myEmpEval = evals[user.id]||{};

  return (
  <div style={{minHeight:"100vh",background:APP_BG,fontFamily:"'El Messiri',sans-serif",direction:"rtl",color:"#1E293B"}}>
   <link href="https://fonts.googleapis.com/css2?family=El+Messiri:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet"/>
   {toast&&<div style={{position:"fixed",top:18,left:"50%",transform:"translateX(-50%)",background:toast.c,color:"#fff",padding:"11px 26px",borderRadius:30,fontWeight:700,fontSize:13,zIndex:9999,boxShadow:`0 8px 28px ${toast.c}55`,animation:"fadeInUp 0.3s ease"}}>{toast.msg}</div>}

   <header style={{background:"rgba(255,255,255,0.82)",backdropFilter:"blur(14px)",borderBottom:"1px solid #C7DBF0",padding:"0 20px",position:"sticky",top:0,zIndex:100,boxShadow:"0 4px 18px rgba(46,127,184,0.08)"}}>
  <div style={{maxWidth:900,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",height:54}}>
  <div style={{display:"flex",alignItems:"center",gap:10}}>
<LogoImg style={{height:32}} size={15}/>
   <div>
   <div style={{fontWeight:900,fontSize:13}}>{user.name} — {party.label}</div>
   <div style={{fontSize:10,color:"#5B7A9E"}}>{myTargets.length} موظف • يُقيّم: {allowedCats.join(" + ")}</div>
   </div>
  </div>
  <div style={{display:"flex",gap:6}}>
   <ChangePasswordButton userId={user.id} currentPassword={user.password}/>
   <RefreshButton/><button onClick={onLogout} style={{padding:"5px 12px",borderRadius:20,border:"1px solid #EF444430",background:"#EF444410",color:"#EF4444",fontSize:11,cursor:"pointer",marginRight:6}}>خروج</button>
  </div>
  </div>
   </header>

   <main className="print-area" style={{maxWidth:900,margin:"0 auto",padding:"20px 16px"}}>
  {/* شريط التبويبات الأربعة */}
  <div style={{display:"flex",gap:6,marginBottom:18,flexWrap:"wrap"}}>
  {[
   {k:"team_growth",l:"👥 متابعة التطور المهني",c:"#10B981"},
   {k:"team_eval",  l:"📋 متابعة تقييم الأداء",c:"#3B82F6"},
   {k:"my_growth",  l:"🎯 خطتي المهنية",c:"#8B5CF6"},
   {k:"my_eval",    l:"📊 تقييم أدائي",c:"#F59E0B"},
  ].map(t=>(
   <button key={t.k} onClick={()=>setSupTab(t.k)}
   style={{flex:"1 1 auto",minWidth:150,padding:"13px 18px",borderRadius:24,border:"none",background:supTab===t.k?`linear-gradient(135deg,${t.c},${t.c}cc)`:"#fff",color:supTab===t.k?"#fff":"#5B7A9E",fontSize:13,fontWeight:800,cursor:"pointer",boxShadow:supTab===t.k?`0 8px 22px ${t.c}45`:"0 2px 10px rgba(46,127,184,0.08)"}}>
   {t.l}
   </button>
  ))}
  </div>

  {/* ═══ التبويب 1: خطتي المهنية ═══ */}
  {supTab==="my_growth"&&(
  <EmployeeGrowthPlan user={user} empEval={myEmpEval} idpData={idps[user.id]} onSave={saveMyIdp} viewerRole="employee" impactData={impactData} minHours={getEvalModel(user)==="leader"?15:12}/>
  )}

  {/* ═══ التبويب 2: تقييم أدائي ═══ */}
  {supTab==="my_eval"&&(
  <div>
   <div style={{background:"#FFFFFF",border:"1px solid #F59E0B25",borderRadius:12,padding:"14px 18px",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
   <div>
  <div style={{fontSize:14,fontWeight:900,color:"#D97706"}}>📊 تقييم أدائي الوظيفي</div>
  <div style={{fontSize:11,color:"#5B7A9E",marginTop:2}}>تقييمك كموظف من الأطراف المختلفة</div>
   </div>
   <button onClick={()=>setMyCardOpen(true)} style={{padding:"8px 16px",borderRadius:10,border:"1px solid #F59E0B40",background:"#F59E0B12",color:"#D97706",fontSize:12,fontWeight:700,cursor:"pointer"}}>📋 عرض بطاقتي الكاملة</button>
   </div>
   {(()=>{
   const st360 = getEmpFullStats(user, myEmpEval);
   return(
  <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:12}}>
  {EVAL_PARTIES.map(p=>{
  const ps=st360?.partyScores?.[p.key]; const lv=ps?getLevel(ps.avg):null;
  const pct = ps? (ps.avg/5)*ps.weight : null;
  return(
  <div key={p.key} style={{flex:1,minWidth:120,background:"#FFFFFF",border:`1px solid ${p.color}25`,borderRadius:12,padding:"12px",textAlign:"center"}}>
   <div style={{fontSize:11,color:p.color,fontWeight:700,marginBottom:4}}>{p.icon} {p.label}</div>
   {ps?<><div style={{fontSize:18,fontWeight:900,color:lv.color,fontFamily:MONO}}>{pct.toFixed(1)}<span style={{fontSize:11}}>%</span></div><div style={{fontSize:9,color:"#5B7A9E"}}>من {ps.weight}%</div></>:<div style={{fontSize:11,color:"#5B7A9E",marginTop:6}}>⏳ بانتظار</div>}
  </div>
  );
  })}
  </div>
   );
   })()}
   {/* زر التقييم الذاتي */}
   {(()=>{
   const selfDone = Object.keys(myEmpEval.self||{}).length>0;
   const selfLocked = !!(locks && locks[`${user.id}__self`]);
   const winSt = branchWindowStatus(evalWinData, user.branch);
   return(
  <div style={{background:"#10B9810D",border:"1px solid #10B98125",borderRadius:12,padding:"14px 18px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
  <div>
  <div style={{fontSize:13,fontWeight:800,color:"#10B981"}}>👤 التقييم الذاتي</div>
  <div style={{fontSize:11,color:"#5B7A9E",marginTop:2}}>قيّم نفسك في جداراتك (أساسية + عامة + فنية)</div>
  <div style={{marginTop:4}}><span style={{fontSize:10,color:winSt.color,background:`${winSt.color}12`,padding:"2px 10px",borderRadius:10,fontWeight:700}}>{winSt.icon} حالة تقييم فرعك: {winSt.label}</span></div>
  </div>
  {selfLocked
  ? <span style={{padding:"7px 16px",borderRadius:10,background:"#EF444410",border:"1px solid #EF444430",color:"#EF4444",fontSize:12,fontWeight:700}}>🔒 مقفول</span>
  : winSt.open
  ? <button onClick={()=>setSelfTarget(user)} style={{padding:"10px 20px",borderRadius:22,border:selfDone?"1px solid #10B98140":"none",background:selfDone?"#10B98115":"linear-gradient(135deg,#059669,#10B981)",color:selfDone?"#10B981":"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>{selfDone?"✏️ تعديل تقييمي الذاتي":"▶ ابدأ تقييمي الذاتي"}</button>
  : <span style={{padding:"7px 16px",borderRadius:10,background:"#F1F5F9",border:"1px solid #E2E8F0",color:"#94A3B8",fontSize:12,fontWeight:700}} title={selfDone?"التقييم مغلق — لا يمكن التعديل":"التقييم مغلق"}>🔒 التقييم مغلق{selfDone?" (مكتمل)":""}</span>}
  </div>
   );
   })()}
  </div>
  )}
  {supTab==="team_growth"&&partyKey==="supervisor"&&(
  <SupervisorTeamGrowth
   myTargets={myTargets} idps={idps} evals={evals} editRequests={editRequests} approvals={approvals} impactData={impactData} onSaveImpact={saveImpact}
   user={user}
   onApprove={saveTeamIdp} onSaveIdp={saveTeamIdp} onRequestEdit={requestEdit}
   onOpenPlan={setPlanTarget}
  />
  )}
  {supTab==="team_growth"&&partyKey!=="supervisor"&&(
  <div style={{textAlign:"center",padding:50,color:"#5B7A9E"}}>متابعة التطور المهني متاحة للمتابع الفني فقط</div>
  )}

  {/* ═══ التبويب 4: متابعة تقييم الأداء للموظفين ═══ */}
  {supTab==="team_eval"&&(<>
  {(()=>{
  const stagesOf = [...new Set(myTargets.map(u=>`${u.branch}__${u.stage}`).filter(k=>!k.startsWith("undefined")))];
  const approvedStages = stagesOf.filter(k=>approvals[`${k}__eval`]?.approved);
  if(!approvedStages.length) return null;
  return(
   <div style={{background:"#10B98112",border:"1px solid #10B98140",borderRadius:12,padding:"12px 16px",marginBottom:14,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
   <span style={{fontSize:22}}>✅</span>
   <div style={{flex:1,minWidth:200}}>
  <div style={{fontSize:13,fontWeight:900,color:"#10B981"}}>نتائج تقييم معتمدة من مدير الفرع</div>
  <div style={{fontSize:10,color:"#5B7A9E",marginTop:2}}>بدأت قراءة النتائج لمرحلة: {approvedStages.map(k=>k.split("__")[1]).join(" • ")}</div>
   </div>
   </div>
  );
  })()}
  {/* توضيح الدور */}
  <div style={{background:"#FFFFFF",border:`1px solid ${party.color}20`,borderRadius:12,padding:"12px 16px",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
  <div style={{flex:1}}>
   <div style={{fontSize:12,color:"#5B7A9E",marginBottom:8}}>نطاق تقييمك في هذا النظام:</div>
   <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
   {allowedCats.map(cat=>(
  <div key={cat} style={{background:`${CAT_COLORS[cat]}15`,border:`1px solid ${CAT_COLORS[cat]}25`,borderRadius:8,padding:"6px 14px"}}>
  <span style={{color:CAT_COLORS[cat],fontSize:12,fontWeight:700}}>{cat}</span>
  <span style={{fontSize:11,color:"#5B7A9E",marginRight:8}}>← وزن <strong style={{color:party.color,fontFamily:MONO}}>{PARTY_CAT_WEIGHTS[partyKey][cat]}%</strong></span>
  </div>
   ))}
   </div>
  </div>
  <button onClick={()=>setShowReport(true)} style={{padding:"8px 16px",borderRadius:10,border:"1px solid #3B82F640",background:"#3B82F615",color:"#3B82F6",fontSize:12,cursor:"pointer",fontWeight:700}}>📑 تحليل التقييمات</button>
  </div>

  {myTargets.length===0 ? (
  <div style={{textAlign:"center",padding:60,color:"#1E293B"}}><div style={{fontSize:40,marginBottom:12}}>👥</div>لا يوجد موظفون مرتبطون بك</div>
  ) : myTargets.map(u=>{
  const empEval = evals[u.id]||{};
  const myEval = empEval[partyKey]||{};
  const myComps = (getActiveJobs()[u.job]||[]).filter(c=>allowedCats.includes(getCat(c)));
  const scoredItems = myComps.reduce((s,c)=>{
   const items=getActiveComps()[c]?.items||[];
   return s+items.filter((_,i)=>(myEval[c]?.[i]||0)>0).length;
  },0);
  const totalItems = myComps.reduce((s,c)=>(getActiveComps()[c]?.items?.length||0)+s,0);
  const done = scoredItems>0;
  const isTwice = twiceList.includes(u.id);
  const readState = readings[u.id];
  // ب-3: حالة نافذة تقييم فرع هذا الموظف
  const r1Approved = !!(approvals[stageEvalKeyG(u.branch,u.stage)]?.approved);
  const winSt = branchWindowStatus(evalWinData, u.branch);
  return (
   <div key={u.id} style={{background:"#FFFFFF",border:`1px solid ${done?party.color+"25":"#DDE9F5"}`,borderRadius:12,padding:"14px 16px",display:"flex",alignItems:"center",gap:12,marginBottom:8,flexWrap:"wrap"}}>
   <div style={{width:40,height:40,borderRadius:10,background:done?`${party.color}15`:"#F4F9FE",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{done?"✅":"👤"}</div>
   <div style={{flex:1,minWidth:140}}>
  <div style={{fontWeight:700,fontSize:13,color:"#1E293B"}}>{u.name}</div>
  <div style={{fontSize:11,color:"#5B7A9E"}}>{u.job}{u.branch?` • ${u.branch}`:""}</div>
  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:3}}>
  <span style={{fontSize:9,color:winSt.color,background:`${winSt.color}12`,padding:"1px 7px",borderRadius:10,fontWeight:700}}>{winSt.icon} التقييم {winSt.label}</span>
  {done&&<span style={{fontSize:10,color:party.color}}>✓ {scoredItems}/{totalItems} بند</span>}
  {isTwice&&<span style={{fontSize:9,color:"#F59E0B",background:"#F59E0B12",padding:"1px 7px",borderRadius:10,fontWeight:700}}>🔁 يُقيَّم مرتين</span>}
  {readState&&<span style={{fontSize:9,color:"#10B981",background:"#10B98112",padding:"1px 7px",borderRadius:10}}>👁️ قرأ النتائج</span>}
  </div>
   </div>
   <div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}>
  <button onClick={()=>r1Approved&&toggleTwice(u.id)} disabled={!r1Approved} title={r1Approved?"ترشيح للتقييم الثاني (فرصة تحسين)":"يُتاح بعد اعتماد نتائج التقييم الأول من مدير الفرع"}
  style={{padding:"6px 10px",borderRadius:8,border:`1px solid ${isTwice?"#F59E0B60":"#DDE9F5"}`,background:isTwice?"#F59E0B15":"transparent",color:!r1Approved?"#CBD5E1":(isTwice?"#F59E0B":"#5B7A9E"),fontSize:11,cursor:r1Approved?"pointer":"not-allowed",fontWeight:isTwice?700:400}}>
  {isTwice?"🔁 مرشَّح للثاني":"🔁 ترشيح"}
  </button>
  <button onClick={()=>setViewTarget(u)} style={{padding:"6px 12px",borderRadius:8,border:"1px solid #DDE9F5",background:"transparent",color:"#5B7A9E",fontSize:11,cursor:"pointer"}}>عرض</button>
  <button onClick={()=>setPeerAssign(u)} title="تحديد زميل التخصص المُقيِّم" style={{padding:"6px 10px",borderRadius:8,border:"1px solid #8B5CF640",background:"#8B5CF610",color:"#8B5CF6",fontSize:11,cursor:"pointer",fontWeight:700}}>🤝 زميل</button>
  {(()=>{
  const lk = locks[`${u.id}__${partyKey}`];
  if (lk) return <div style={{padding:"6px 12px",borderRadius:8,background:"#EF444410",border:"1px solid #EF444430",color:"#EF4444",fontSize:11,fontWeight:700}}>🔒 مقفول</div>;
  const noComps = myComps.length===0;
  // ب-3: لا يُسمح ببدء/تعديل التقييم إذا كانت نافذة فرع الموظف مغلقة (إلا العرض)
  if (!winSt.open && !done) return <div style={{padding:"6px 12px",borderRadius:8,background:"#F1F5F9",border:"1px solid #E2E8F0",color:"#94A3B8",fontSize:11,fontWeight:700}} title="لا يمكن التقييم — نافذة تقييم الفرع مغلقة">🔒 التقييم مغلق</div>;
  return (
  <button onClick={()=>setEvalTarget(u)}
  title={noComps?"لا جدارات عامة/فنية لهذا المسمى — راجع مصفوفة الجدارات":(!winSt.open?"النافذة مغلقة — عرض فقط":"تقييم الجدارات العامة والفنية")}
  style={{padding:"7px 16px",borderRadius:8,border:done?`1.5px solid ${party.color}`:"none",background:noComps?"#F59E0B":done?"#fff":`linear-gradient(135deg,${party.color}cc,${party.color})`,color:noComps?"#fff":done?party.color:"#fff",fontSize:12,cursor:"pointer",fontWeight:800}}>
  {noComps?"⚠️ تقييم":done?`✏️ تعديل (${scoredItems}/${totalItems})`:"📝 تقييم ▶"}
  </button>
  );
  })()}
   </div>
   </div>
  );
  })}
  </>)}
   </main>
   {myCardOpen&&<Card360 targetUser={user} empEval={myEmpEval} idpData={idps[user.id]} readings={readings} onSaveReadings={async d=>{setReadings(d);await st.set("readings_360c",d);}} currentUser={user} hidePrint onClose={()=>setMyCardOpen(false)}/>}
   {selfTarget&&<EvalForm partyKey="self" targetUser={user} existingScores={myEmpEval.self||{}} onSave={saveMySelfEval} onCancel={()=>setSelfTarget(null)} locks={locks} onLock={async(key)=>{const nl={...(locks||{}),[key]:{lockedAt:new Date().toISOString()}};setLocks(nl);await st.set('locks_360c',nl);}}/>}

   {peerAssign&&(()=>{
  const curIds = peerAssign.peerIds || (peerAssign.peerId?[peerAssign.peerId]:[]);
  return(
  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>{if(e.target===e.currentTarget)setPeerAssign(null);}}>
  <div style={{background:"#FFFFFF",border:"1px solid #8B5CF640",borderRadius:20,width:"100%",maxWidth:440,padding:24,direction:"rtl"}}>
   <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
   <span style={{fontSize:15,fontWeight:900,color:"#8B5CF6"}}>🤝 تحديد زملاء التخصص المُقيِّمين</span>
   <button onClick={()=>setPeerAssign(null)} style={{background:"none",border:"none",color:"#5B7A9E",fontSize:22,cursor:"pointer"}}>✕</button>
   </div>
   <div style={{background:"#F4F9FE",borderRadius:10,padding:"12px 14px",marginBottom:16}}>
   <div style={{fontSize:13,fontWeight:700,color:"#1E293B"}}>{peerAssign.name}</div>
   <div style={{fontSize:11,color:"#5B7A9E",marginTop:2}}>{peerAssign.job}</div>
   <div style={{fontSize:11,color:"#5B7A9E",marginTop:6}}>عدد الزملاء المحدّدين: <span style={{color:curIds.length?"#8B5CF6":"#EF4444",fontWeight:700}}>{curIds.length}</span></div>
   </div>
   <div style={{fontSize:11,color:"#5B7A9E",marginBottom:8,background:"#8B5CF60D",borderRadius:8,padding:"8px 12px",lineHeight:1.7}}>
   زملاء التخصص يُقيّمون هذا الموظف في الجدارات الأساسية (وزن 5%). اختر <strong>زميلاً أو أكثر</strong>. لن تظهر درجة الزملاء للموظف إلا إذا قيّمه <strong>اثنان فأكثر</strong>، وتظهر كمتوسط دون كشف هوية المُقيّم.
   </div>
   <label style={{display:"block",fontSize:11,color:"#5B7A9E",marginBottom:6,fontWeight:700}}>اختر زملاء التخصص (اضغط للتحديد/الإلغاء)</label>
   <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:240,overflowY:"auto",marginBottom:14}}>
   {myTargets.filter(t=>t.id!==peerAssign.id).map(t=>{
  const isSel = curIds.includes(t.id);
  return(
  <button key={t.id} onClick={()=>{const next=isSel?curIds.filter(x=>x!==t.id):[...curIds,t.id];assignPeer(peerAssign.id,next);}}
  style={{padding:"11px 14px",borderRadius:10,border:`1px solid ${isSel?"#8B5CF6":"#C7DBF0"}`,background:isSel?"#8B5CF610":"#F4F9FE",color:isSel?"#8B5CF6":"#5B7A9E",fontSize:12,cursor:"pointer",textAlign:"right",display:"flex",justifyContent:"space-between",alignItems:"center",fontWeight:isSel?700:400}}>
  <span>{t.name}<span style={{fontSize:10,color:"#5B7A9E"}}> • {t.job}</span></span>
  {isSel&&<span style={{fontSize:13,color:"#8B5CF6"}}>✓</span>}
  </button>
  );
   })}
   </div>
   <button onClick={()=>setPeerAssign(null)} style={{width:"100%",padding:"10px",borderRadius:10,border:"1px solid #C7DBF0",background:"transparent",color:"#5B7A9E",cursor:"pointer"}}>تم</button>
  </div>
  </div>
  );})()}

   {showReport&&(
  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:12}}>
  <div style={{background:"#FFFFFF",border:"1px solid #B3D0EA",borderRadius:20,width:"100%",maxWidth:1000,maxHeight:"95vh",overflowY:"auto",padding:24}}>
   <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
   <div style={{fontSize:14,color:"#2E7FB8",fontWeight:900}}>📑 التقرير المجمع — موظفوك</div>
   <button onClick={()=>setShowReport(false)} style={{background:"none",border:"none",color:"#5B7A9E",fontSize:22,cursor:"pointer"}}>✕</button>
   </div>
   <AggregateReport users={myTargets} evals={evals} currentUser={user} restrictBranch/>
  </div>
  </div>
   )}
   {evalTarget&&<EvalForm partyKey={partyKey} targetUser={evalTarget} existingScores={readPartyScore(evals[evalTarget.id]||{},partyKey,evalTarget.id)} onSave={scores=>saveEval(evalTarget.id,scores)} onCancel={()=>setEvalTarget(null)} locks={locks} onLock={async(key)=>{const nl={...(locks||{}),[key]:{lockedAt:new Date().toISOString()}};setLocks(nl);await st.set('locks_360c',nl);}}/>}
   {viewTarget&&<Card360 targetUser={viewTarget} empEval={evals[viewTarget.id]||{}} idpData={idps[viewTarget.id]} onSaveIdp={async d=>{const ni={...idps,[viewTarget.id]:d};setIdpsState(ni);await st.set("idps_360c",ni);}} readings={readings} onSaveReadings={async d=>{setReadings(d);await st.set("readings_360c",d);}} currentUser={user} hidePrint onClose={()=>setViewTarget(null)}/>}

   {planTarget&&(
  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:12}}>
  <div style={{background:"#FFFFFF",border:"1px solid #B3D0EA",borderRadius:20,width:"100%",maxWidth:780,maxHeight:"95vh",overflowY:"auto",padding:24}}>
   <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
   <div>
  <div style={{fontSize:15,color:"#2E7FB8",fontWeight:900}}>🎯 خطة التطور المهني — {planTarget.name}</div>
  <div style={{fontSize:11,color:"#5B7A9E",marginTop:2}}>{planTarget.job}{planTarget.branch?` • ${planTarget.branch}`:""}</div>
   </div>
   <button onClick={()=>setPlanTarget(null)} style={{background:"none",border:"none",color:"#5B7A9E",fontSize:22,cursor:"pointer"}}>✕</button>
   </div>
   <EmployeeGrowthPlan
   user={{...planTarget,_approverName:user.name}}
   empEval={evals[planTarget.id]||{}}
   idpData={idps[planTarget.id]}
   onSave={async d=>{const ni={...idps,[planTarget.id]:d};setIdpsState(ni);await st.set("idps_360c",ni);showToast("✓ تم حفظ الخطة");}}
   viewerRole="supervisor"
   impactData={impactData}
   />
  </div>
  </div>
   )}
  </div>
  );
}

function EmployeeGrowthPlan({ user, empEval, idpData, onSave, viewerRole, impactData, minHours=12 }) {
  const role = viewerRole || "employee"; // employee | supervisor | branch_mgr
  const [growTab,setGrowTab] = useState("sources"); // sources | plan
  const [idpPlan,setIdpPlan] = useState(idpData?.plan||[]);
  const [selSources,setSelSources] = useState(idpData?.selSources||{});
  const [goals,setGoals] = useState(idpData?.goals||{});
  const [openComp,setOpenComp] = useState(null);
  const [approved,setApproved] = useState(idpData?.approved||false);
  const [approvedBy,setApprovedBy] = useState(idpData?.approvedBy||"");
  const [approvedAt,setApprovedAt] = useState(idpData?.approvedAt||"");
  // د-9: الشهادة الاحترافية
  const [cert,setCert] = useState(idpData?.certificate||null); // {name, isOther, status}
  const [intCourseData,setIntCourseData] = useState({}); // بيانات الدورات الحضورية من إدارة التدريب
  useEffect(()=>{ st.get("intcourses_360c").then(d=>setIntCourseData(d||{})); },[]);
  useEffect(()=>{ setCert(idpData?.certificate||null); },[idpData]);
  useEffect(()=>{ setIdpPlan(idpData?.plan||[]); setSelSources(idpData?.selSources||{}); setGoals(idpData?.goals||{}); setApproved(idpData?.approved||false); setApprovedBy(idpData?.approvedBy||""); setApprovedAt(idpData?.approvedAt||""); },[idpData]);

  const canEditFields = approved ? (role==="branch_mgr") : (role==="employee"||role==="supervisor");
  const canEditStatus = approved && (role==="employee"||role==="supervisor"||role==="branch_mgr");
  const canApprove = role==="supervisor";

  const comps = getActiveJobs()[user.job]||[];
  const prioritized = useMemo(()=>comps
  .map(c=>({ c, ws: calcWeightedComp(c, empEval||{}, user) }))
  .filter(x=>x.ws!==null)
  .map(x=>({ c:x.c, score:x.ws.score, gap:5-x.ws.score }))
  .filter(x=>x.gap>=0.5)
  .sort((a,b)=>b.gap-a.gap)
  ,[comps,empEval]);
  const isBook = s => s.startsWith("كتاب");
  const toggleSrc = (comp,src) => setSelSources(p=>{ const cur=p[comp]||[]; return {...p,[comp]:cur.includes(src)?cur.filter(s=>s!==src):[...cur,src]}; });

  const newRow = (cat) => ({id:Date.now().toString()+Math.random().toString(36).slice(2,6),cat:cat||"أساسية",mode:"auto",comp:"",needSource:"",trainMethod:"",programName:"",provider:"",url:"",cost:"",hours:"",targetDate:"",evalMethod:""});
  const addRow    = (cat) => setIdpPlan(p=>[...p,newRow(cat)]);
  const updRow    = (id,f,v) => setIdpPlan(p=>p.map(r=>r.id===id?{...r,[f]:v}:r));
  const delRow    = (id) => setIdpPlan(p=>p.filter(r=>r.id!==id));

  const compsByCat = useMemo(()=>{
  const res = {أساسية:[],عامة:[],فنية:[]};
  comps.forEach(c=>{ const cat=getCat(c); if(res[cat]) res[cat].push(c); });
  return res;
  },[comps]);

  const applyAutoSource = (id, srcName) => {
  const info = getSourceInfo(srcName);
  setIdpPlan(p=>p.map(r=>r.id===id?{
   ...r, programName:srcName,
   provider: info?.provider||"", url: info?.url||"",
   cost: info?.cost>0?String(info.cost):"مجاني",
   hours: info?.hours>0?String(info.hours):"",
   trainMethod: info?.method||"",
  }:r));
  };

  const iS={width:"100%",padding:"8px 10px",background:"#FFFFFF",border:"1px solid #C7DBF0",borderRadius:8,color:"#1E293B",fontSize:12,boxSizing:"border-box",outline:"none"};
  const lS={display:"block",fontSize:10,color:"#5B7A9E",marginBottom:4,fontWeight:700};

  const saveAll = () => onSave({...(idpData||{}),selSources,goals,plan:idpPlan,certificate:cert,approved,approvedBy,approvedAt});

  // التحقق من شروط الحفظ النهائي (حفظ وإغلاق):
  // 1) بند لكل فئة (أساسية/عامة/فنية)  2) اكتمال كل الحقول  3) إجمالي ساعات ≥ 12
  const planReadiness = (() => {
   const cats = ["أساسية","عامة","فنية"];
   // الفئة: من r.cat، أو من فئة الجدارة، أو من الجدارة المرتبطة بالمصدر
   const rowCat = (r) => r.cat || (r.comp ? getCat(r.comp) : null);
   const coveredCats = new Set(idpPlan.map(rowCat).filter(Boolean));
   // إن لم تُحدَّد فئات إطلاقاً (خطة من المخطّط المبسّط بلا cat)، لا نُلزم تغطية الفئات الثلاث
   const anyCat = idpPlan.some(r => rowCat(r));
   const missingCats = anyCat ? cats.filter(c => !coveredCats.has(c)) : [];
   // وضع الصف: صريح (auto/manual) أو مُستنتَج — وجود comp/programName ⇒ تلقائي (من المكتبة)
   const isAuto = (r) => r.mode ? r.mode==="auto" : !!((r.comp&&String(r.comp).trim())||(r.programName&&String(r.programName).trim()));
   const rowIncomplete = (r) => {
    const auto = isAuto(r);
    const need = auto
     ? ["programName","targetDate","evalMethod"]
     : ["needSource","trainMethod","programName","targetDate","evalMethod"];
    return need.some(f => !r[f] || String(r[f]).trim()==="");
   };
   const incompleteRows = idpPlan.filter(rowIncomplete);
   const totalHours = idpPlan.reduce((s,r) => s + (parseFloat(String(r.hours||"").replace(/[^\d.]/g,"")) || 0), 0);
   const ok = idpPlan.length>0 && missingCats.length===0 && incompleteRows.length===0 && totalHours>=minHours;
   return { ok, missingCats, incompleteCount: incompleteRows.length, totalHours };
  })();

  const saveDraft = () => { onSave({...(idpData||{}),selSources,goals,plan:idpPlan,certificate:cert,approved:false,isFinal:false}); };
  const saveAndClose = () => {
   if (!planReadiness.ok) return;
   onSave({...(idpData||{}),selSources,goals,plan:idpPlan,certificate:cert,approved:false,isFinal:true});
  };

  const approvePlan = () => {
  const at = new Date().toISOString().split("T")[0];
  const nm = user?._approverName||"المتابع الفني";
  setApproved(true); setApprovedBy(nm); setApprovedAt(at);
  onSave({...(idpData||{}),selSources,goals,plan:idpPlan,certificate:cert,approved:true,approvedBy:nm,approvedAt:at});
  };
  const unapprovePlan = () => {
  setApproved(false);
  onSave({...(idpData||{}),selSources,goals,plan:idpPlan,certificate:cert,approved:false,approvedBy:"",approvedAt:""});
  };
  const setRowStatus = (id,status) => {
  const np = idpPlan.map(r=>r.id===id?{...r,status}:r);
  setIdpPlan(np);
  onSave({...(idpData||{}),selSources,goals,plan:np,certificate:cert,approved,approvedBy,approvedAt});
  };

  const totals = useMemo(()=>{
  let hours=0, cost=0, done=0, inProgress=0;
  idpPlan.forEach(r=>{
   const h = parseFloat(String(r.hours||"").replace(/[^\d.]/g,""));
   const c = parseFloat(String(r.cost||"").replace(/[^\d.]/g,""));
   if(!isNaN(h)) hours += h;
   if(!isNaN(c)) cost += c;
   if(r.status==="تم التنفيذ") done++;
   else if(r.status==="جاري التنفيذ") inProgress++;
  });
  const total = idpPlan.length;
  const pct = total>0 ? Math.round((done + inProgress*0.5)/total*100) : 0;
  return { hours, cost, count: total, done, inProgress, pct };
  },[idpPlan]);

  return(
  <div>
   <div style={{background:"#10B9810D",border:"1px solid #10B98130",borderRadius:12,padding:"12px 16px",marginBottom:14,fontSize:12,color:"#94A3B8",lineHeight:1.7}}>
  🎯 خطتك للتطور المهني — تُبنى تعاونياً بينك وبين المتابع الفني/المدير المباشر.
   </div>

   {/* خطة التطوير الفردي */}
   {(
  <div>
  {/* بنر حالة الاعتماد */}
  {approved?(
   <div style={{background:"#10B98112",border:"1px solid #10B98140",borderRadius:12,padding:"12px 16px",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
   <div style={{display:"flex",alignItems:"center",gap:10}}>
  <span style={{fontSize:22}}>✅</span>
  <div>
  <div style={{fontSize:13,fontWeight:900,color:"#10B981"}}>معتمدة من المتابع الفني</div>
  <div style={{fontSize:10,color:"#5B7A9E",marginTop:2}}>{approvedBy&&`اعتمدها: ${approvedBy}`}{approvedAt&&` • ${approvedAt}`}</div>
  </div>
   </div>
   {canApprove&&<button onClick={unapprovePlan} style={{padding:"5px 12px",borderRadius:20,border:"1px solid #EF444440",background:"#EF444410",color:"#EF4444",fontSize:10,cursor:"pointer"}}>↩ إلغاء الاعتماد</button>}
   </div>
  ):(
   <div style={{background:"#F59E0B0D",border:"1px solid #F59E0B30",borderRadius:12,padding:"12px 16px",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
   <div style={{display:"flex",alignItems:"center",gap:10}}>
  <span style={{fontSize:22}}>⏳</span>
  <div>
  <div style={{fontSize:13,fontWeight:900,color:"#F59E0B"}}>{role==="supervisor"?(idpData?.isFinal?"بانتظار اعتمادك":"لم يُنهِ الموظف التخطيط بعد"):"غير معتمدة من المتابع الفني"}</div>
  <div style={{fontSize:10,color:"#5B7A9E",marginTop:2}}>{role==="supervisor"?(idpData?.isFinal?"راجع بنود الخطة ثم اعتمدها":"الخطة في مرحلة الحفظ المؤقت — تُعتمد بعد أن يحفظها الموظف ويغلق التخطيط"):"يمكنك التعديل حتى يعتمدها المتابع الفني"}</div>
  </div>
   </div>
   {canApprove&&idpPlan.length>0&&idpData?.isFinal&&<button onClick={approvePlan} style={{padding:"7px 18px",borderRadius:20,border:"none",background:"linear-gradient(135deg,#059669,#10B981)",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>✅ اعتماد الخطة</button>}
   {canApprove&&idpPlan.length>0&&!idpData?.isFinal&&<span style={{padding:"7px 14px",borderRadius:20,background:"#F1F5F9",color:"#94A3B8",fontSize:11,fontWeight:700}}>⏳ بانتظار إغلاق الموظف للتخطيط</span>}
   </div>
  )}

  {/* لوحة الإجماليات */}
  <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
   <div style={{flex:1,minWidth:110,background:"linear-gradient(135deg,#B3D0EA,#FFFFFF)",border:"1px solid #3B82F640",borderRadius:14,padding:"14px 16px"}}>
   <div style={{fontSize:11,color:"#2E7FB8",fontWeight:700,marginBottom:4}}>📋 عدد البنود</div>
   <div style={{fontSize:22,fontWeight:900,color:"#1E293B",fontFamily:MONO}}>{totals.count}<span style={{fontSize:11,color:"#5B7A9E"}}> / 3</span></div>
   </div>
   <div style={{flex:1,minWidth:110,background:"linear-gradient(160deg,#FFFFFF,#ECFBFA)",border:"1px solid #06B6D440",borderRadius:14,padding:"14px 16px"}}>
   <div style={{fontSize:11,color:"#67E8F9",fontWeight:700,marginBottom:4}}>⏱️ الساعات</div>
   <div style={{fontSize:22,fontWeight:900,color:"#1E293B",fontFamily:MONO}}>{totals.hours%1===0?totals.hours:totals.hours.toFixed(1)}</div>
   </div>
   <div style={{flex:1,minWidth:110,background:"linear-gradient(160deg,#FFFFFF,#FEF8EF)",border:"1px solid #F59E0B40",borderRadius:14,padding:"14px 16px"}}>
   <div style={{fontSize:11,color:"#D97706",fontWeight:700,marginBottom:4}}>💰 التكلفة</div>
   <div style={{fontSize:22,fontWeight:900,color:"#1E293B",fontFamily:MONO}}>{totals.cost>0?totals.cost.toLocaleString("en-US"):"0"}<span style={{fontSize:10,color:"#5B7A9E"}}> ﷼</span></div>
   </div>
   {approved&&(
   <div style={{flex:1,minWidth:110,background:"linear-gradient(160deg,#FFFFFF,#EDFBF4)",border:"1px solid #10B98140",borderRadius:14,padding:"14px 16px"}}>
  <div style={{fontSize:11,color:"#059669",fontWeight:700,marginBottom:4}}>📊 نسبة التنفيذ</div>
  <div style={{fontSize:22,fontWeight:900,color:totals.pct>=100?"#10B981":totals.pct>=50?"#F59E0B":"#94A3B8",fontFamily:MONO}}>{totals.pct}%</div>
  <div style={{height:4,background:"#DDE9F5",borderRadius:2,overflow:"hidden",marginTop:4}}>
  <div style={{width:`${totals.pct}%`,height:"100%",background:totals.pct>=100?"#10B981":"#F59E0B",borderRadius:2}}/>
  </div>
   </div>
   )}
  </div>

  {["أساسية","عامة","فنية"].map(cat=>{
   const catColor = CAT_COLORS[cat];
   const catRows = idpPlan.filter(r=>(r.cat||"أساسية")===cat);
   const catComps = compsByCat[cat]||[];
   return(
   <div key={cat} style={{marginBottom:18}}>
  {/* رأس الفئة */}
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:`${catColor}12`,border:`1px solid ${catColor}30`,borderRadius:12,padding:"10px 16px",marginBottom:10}}>
  <div style={{fontSize:14,fontWeight:900,color:catColor}}>
  {cat==="أساسية"?"🔷":cat==="عامة"?"🔶":"⭐"} بنود تطويرية — الجدارات {cat==="أساسية"?"الأساسية":cat==="عامة"?"العامة/الإدارية/القيادية":"الفنية"}
  </div>
  <span style={{fontSize:11,color:"#5B7A9E"}}>{catRows.length} بند</span>
  </div>

  {catRows.length===0&&(
  <div style={{textAlign:"center",padding:16,color:"#5B7A9E",fontSize:11,marginBottom:8}}>لم يُضَف بند لهذه الفئة بعد (بند واحد كحد أقصى)</div>
  )}

  {catRows.map((row)=>{
  const F=(f)=>row[f]||"";
  const setF=(f,v)=>updRow(row.id,f,v);
  const idx=idpPlan.findIndex(r=>r.id===row.id);
  const rowSources = row.comp ? (getActiveCompMap()[row.comp]||[]) : [];
  const stColors = {"تم التنفيذ":"#10B981","جاري التنفيذ":"#F59E0B","لم يتم التنفيذ":"#EF4444"};
  const stColor = stColors[row.status]||"#5B7A9E";
  return(
  <div key={row.id} style={{background:"#F4F9FE",border:`1px solid ${approved?stColor+"30":catColor+"25"}`,borderRadius:14,padding:16,marginBottom:10}}>
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
   <span style={{fontSize:13,color:catColor,fontWeight:700}}>بند تطويري {idx+1}</span>
   {approved
   ? <span style={{fontSize:10,color:stColor,background:`${stColor}15`,padding:"3px 10px",borderRadius:20,fontWeight:700}}>{row.status||"لم يتم التنفيذ"}</span>
   : (canEditFields&&<button onClick={()=>delRow(row.id)} style={{background:"none",border:"1px solid #EF444430",borderRadius:8,color:"#EF4444",fontSize:12,cursor:"pointer",padding:"4px 10px"}}>🗑 حذف</button>)
   }
  </div>

  {/* اختيار الخيار */}
  {!approved&&(
  <div style={{display:"flex",gap:8,marginBottom:14}}>
   {[{k:"auto",l:"⚡ اختيار من المكتبة"},{k:"manual",l:"✏️ إدخال يدوي"}].map(opt=>(
   <button key={opt.k} onClick={()=>canEditFields&&setF("mode",opt.k)} disabled={!canEditFields}
   style={{flex:1,padding:"8px",borderRadius:10,border:`2px solid ${row.mode===opt.k?catColor:"#DDE9F5"}`,background:row.mode===opt.k?`${catColor}18`:"transparent",color:row.mode===opt.k?catColor:"#5B7A9E",fontWeight:700,fontSize:12,cursor:canEditFields?"pointer":"default",opacity:canEditFields?1:0.6}}>
   {opt.l}
   </button>
   ))}
  </div>
  )}

  {row.mode==="auto"?(
   /* ═══ الخيار الأول: تلقائي من المكتبة ═══ */
   <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
   <div>
   <label style={lS}>🎯 الجدارة ({cat})</label>
   <select disabled={!canEditFields} value={F("comp")} onChange={e=>{setF("comp",e.target.value);setF("programName","");}} style={{...iS,color:F("comp")?"#15385C":"#5B7A9E"}}>
   <option value="">— اختر الجدارة —</option>
   {catComps.map(c=><option key={c} value={c}>{c}</option>)}
   </select>
   </div>
   <div>
   <label style={lS}>📚 المصدر المقترح</label>
   <select value={F("programName")} disabled={!row.comp} onChange={e=>applyAutoSource(row.id,e.target.value)} style={{...iS,color:F("programName")?"#15385C":"#5B7A9E"}}>
   <option value="">{row.comp?(rowSources.length?"— اختر المصدر —":"لا مصادر مرتبطة"):"اختر الجدارة أولاً"}</option>
   {rowSources.map(s=><option key={s} value={s}>{s}</option>)}
   </select>
   </div>

   {/* بيانات المصدر المعبّأة آلياً */}
   {F("programName")&&(
   <div style={{gridColumn:"1 / -1",background:"#FFFFFF",border:`1px solid ${catColor}20`,borderRadius:10,padding:"12px 14px"}}>
   <div style={{fontSize:10,color:catColor,fontWeight:700,marginBottom:8}}>📋 بيانات المصدر (تلقائية من المكتبة)</div>
   <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
  {F("provider")&&<span style={{fontSize:10,color:"#94A3B8",background:"#DDE9F5",padding:"3px 10px",borderRadius:20}}>🏛️ {F("provider")}</span>}
  {F("trainMethod")&&<span style={{fontSize:10,color:"#8B5CF6",background:"#8B5CF612",padding:"3px 10px",borderRadius:20}}>🎓 {F("trainMethod")}</span>}
  {F("hours")&&<span style={{fontSize:10,color:"#94A3B8",background:"#DDE9F5",padding:"3px 10px",borderRadius:20}}>⏱️ {F("hours")} ساعة</span>}
  <span style={{fontSize:10,color:F("cost")==="مجاني"?"#10B981":"#F59E0B",background:F("cost")==="مجاني"?"#10B98112":"#F59E0B12",padding:"3px 10px",borderRadius:20,fontWeight:700}}>{F("cost")==="مجاني"?"🆓 مجاني":`💰 ${F("cost")} ريال`}</span>
  {isValidUrl(F("url"))
   ? <a href={F("url")} target="_blank" rel="noopener noreferrer" style={{fontSize:10,color:"#3B82F6",background:"#3B82F612",padding:"3px 10px",borderRadius:20,textDecoration:"none",fontWeight:700}}>🔗 فتح الرابط</a>
   : F("url")&&<span style={{fontSize:10,color:"#8B5CF6",background:"#8B5CF610",padding:"3px 10px",borderRadius:20,fontWeight:700}}>{F("url")}</span>}
   </div>
   {/* عدد الساعات: قابل للإدخال إن لم تأتِ من المكتبة (يلزم لإكمال التخطيط) */}
   {!F("hours")&&canEditFields&&(
   <div style={{marginTop:10,display:"flex",alignItems:"center",gap:8}}>
   <label style={{...lS,marginBottom:0,whiteSpace:"nowrap"}}>⏱️ عدد الساعات *</label>
   <input type="number" min="0" value={F("hours")} onChange={e=>setF("hours",e.target.value)} placeholder="أدخل عدد الساعات" style={{...iS,maxWidth:180}}/>
   <span style={{fontSize:9,color:"#94A3B8"}}>لم تُحدَّد في المكتبة — أدخلها لإكمال الخطة</span>
   </div>
   )}
   </div>
   )}

   {/* الحقلان اليدويان */}
   <div>
   <label style={lS}>📅 تاريخ التنفيذ المتوقع</label>
   <input type="date" readOnly={!canEditFields} value={F("targetDate")} onChange={e=>setF("targetDate",e.target.value)} style={iS}/>
   <div style={{fontSize:9,color:"#8CA3BD",marginTop:3,lineHeight:1.5}}>💡 يُفضّل الانتهاء من تنفيذ الدورات خلال الفصل الدراسي الأول</div>
   </div>
   <div>
   <label style={lS}>✅ أسلوب التقييم المقترح</label>
   <select disabled={!canEditFields} value={F("evalMethod")} onChange={e=>setF("evalMethod",e.target.value)} style={{...iS,color:F("evalMethod")?"#15385C":"#5B7A9E"}}>
   <option value="">— اختر —</option>
   {IDP_EVAL_METHODS.map(o=><option key={o} value={o}>{o}</option>)}
   </select>
   </div>
   </div>
  ):(
   /* ═══ الخيار الثاني: يدوي كامل ═══ */
   <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
   <div>
   <label style={lS}>📌 مصدر الاحتياج</label>
   <select disabled={!canEditFields} value={F("needSource")} onChange={e=>setF("needSource",e.target.value)} style={{...iS,color:F("needSource")?"#15385C":"#5B7A9E"}}>
   <option value="">— اختر —</option>
   {IDP_NEED_SOURCES.map(o=><option key={o} value={o}>{o}</option>)}
   </select>
   </div>
   <div>
   <label style={lS}>🎓 أسلوب التدريب</label>
   <select disabled={!canEditFields} value={F("trainMethod")} onChange={e=>setF("trainMethod",e.target.value)} style={{...iS,color:F("trainMethod")?"#15385C":"#5B7A9E"}}>
   <option value="">— اختر —</option>
   {IDP_TRAIN_METHODS.map(o=><option key={o} value={o}>{o}</option>)}
   </select>
   </div>
   <div style={{gridColumn:"1 / -1"}}>
   <label style={lS}>📚 اسم البرنامج أو المادة التعليمية أو الكتاب</label>
   <input readOnly={!canEditFields} value={F("programName")} onChange={e=>setF("programName",e.target.value)} placeholder="مثال: دورة طرق التدريس الحديثة..." style={iS}/>
   </div>
   <div>
   <label style={lS}>🏛️ الجهة التي ستقدّم البرنامج</label>
   <input readOnly={!canEditFields} value={F("provider")} onChange={e=>setF("provider",e.target.value)} style={iS}/>
   </div>
   <div>
   <label style={lS}>🔗 رابط</label>
   <div style={{display:"flex",gap:6}}>
   <input readOnly={!canEditFields} value={F("url")} onChange={e=>setF("url",e.target.value)} placeholder="https://..." style={{...iS,flex:1,direction:"ltr",textAlign:"left"}}/>
   {isValidUrl(F("url"))&&<a href={F("url")} target="_blank" rel="noopener noreferrer" style={{padding:"8px 10px",borderRadius:8,background:"#3B82F615",color:"#3B82F6",fontSize:12,textDecoration:"none",display:"flex",alignItems:"center"}}>🔗</a>}
   </div>
   </div>
   <div>
   <label style={lS}>💰 التكلفة</label>
   <input readOnly={!canEditFields} value={F("cost")} onChange={e=>setF("cost",e.target.value)} placeholder="ريال / مجاني" style={iS}/>
   </div>
   <div>
   <label style={lS}>⏱️ عدد الساعات</label>
   <input readOnly={!canEditFields} value={F("hours")} onChange={e=>setF("hours",e.target.value)} style={iS}/>
   </div>
   <div>
   <label style={lS}>📅 تاريخ التنفيذ المتوقع</label>
   <input type="date" readOnly={!canEditFields} value={F("targetDate")} onChange={e=>setF("targetDate",e.target.value)} style={iS}/>
   <div style={{fontSize:9,color:"#8CA3BD",marginTop:3,lineHeight:1.5}}>💡 يُفضّل الانتهاء من تنفيذ الدورات خلال الفصل الدراسي الأول</div>
   </div>
   <div style={{gridColumn:"1 / -1"}}>
   <label style={lS}>✅ أسلوب التقييم المقترح</label>
   <select disabled={!canEditFields} value={F("evalMethod")} onChange={e=>setF("evalMethod",e.target.value)} style={{...iS,color:F("evalMethod")?"#15385C":"#5B7A9E"}}>
   <option value="">— اختر —</option>
   {IDP_EVAL_METHODS.map(o=><option key={o} value={o}>{o}</option>)}
   </select>
   </div>
   </div>
  )}

  {/* قائمة حالة التنفيذ — بعد الاعتماد */}
  {approved&&(
   <div style={{marginTop:14,paddingTop:14,borderTop:`1px solid ${stColor}20`}}>
   <label style={{...lS,color:stColor}}>📍 حالة تنفيذ الدورة</label>
   <select value={row.status||"لم يتم التنفيذ"} disabled={!canEditStatus} onChange={e=>setRowStatus(row.id,e.target.value)}
   style={{...iS,color:stColor,fontWeight:700,border:`1px solid ${stColor}40`,cursor:canEditStatus?"pointer":"default",opacity:canEditStatus?1:0.7}}>
   {["لم يتم التنفيذ","جاري التنفيذ","تم التنفيذ"].map(s=><option key={s} value={s}>{s}</option>)}
   </select>
   </div>
  )}
  {/* بيانات الدورة الحضورية الداخلية من إدارة التدريب (تاريخ/مكان/مدرب) */}
  {(()=>{
   const _ms=`${row.trainMethod||""} ${row.method||""} ${row.needSource||""}`;
   const isInt=_ms.includes("حضورية داخلية")||_ms.includes("داخلي حضوري");
   if(!isInt) return null;
   const cname=row.programName||row.comp||"";
   const cd=intCourseData[`${cname}__${user.id}`]||{};
   const has=cd.actualDate||cd.location||cd.trainer||cd.status;
   const pct=cd.attendPct!==undefined&&cd.attendPct!==""?Number(cd.attendPct):null;
   const certEligible=pct!==null&&pct>CERT_MIN_ATTENDANCE;
   return(
   <div style={{marginTop:12,background:"#8B5CF608",border:"1px solid #8B5CF625",borderRadius:10,padding:"10px 12px"}}>
   <div style={{fontSize:11,fontWeight:800,color:"#7C3AED",marginBottom:has?6:0}}>🏫 تفاصيل الدورة الحضورية من إدارة التدريب</div>
   {has?(
   <div style={{display:"flex",flexWrap:"wrap",gap:10,fontSize:11,color:"#15385C"}}>
   {cd.actualDate&&<span>📅 {cd.actualDate}</span>}
   {cd.location&&<span>📍 {cd.location}</span>}
   {cd.trainer&&<span>👨‍🏫 {cd.trainer}</span>}
   {cd.status&&<span style={{fontWeight:700,color:"#7C3AED"}}>• {cd.status}</span>}
   {cd.attendPct!=null&&cd.attendPct!==""&&<span>📊 الحضور {cd.attendPct}%</span>}
   </div>
   ):(
   <div style={{fontSize:10,color:"#94A3B8"}}>⏳ لم تُحدَّد تفاصيل التنفيذ بعد — ستصلك من إدارة التدريب</div>
   )}
   {certEligible&&(
   <button onClick={()=>generateAttendanceCertificate({name:user.name,courseName:cname,date:cd.actualDate||"",hours:row.hours||cd.hours||"",trainer:cd.trainer||""})}
    style={{marginTop:8,padding:"7px 14px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#059669,#10B981)",color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>🎓 تنزيل شهادة الحضور</button>
   )}
   {pct!==null&&!certEligible&&(
   <div style={{marginTop:8,fontSize:10,color:"#94A3B8"}}>🎓 تُتاح شهادة الحضور عند تجاوز نسبة الحضور {CERT_MIN_ATTENDANCE}%</div>
   )}
   </div>
   );
  })()}
  </div>
  );
  })}

  {catRows.length===0&&canEditFields&&(
  <button onClick={()=>addRow(cat)} style={{width:"100%",padding:"10px",borderRadius:10,border:`1px dashed ${catColor}60`,background:`${catColor}0D`,color:catColor,fontWeight:700,fontSize:12,cursor:"pointer"}}>
  ➕ إضافة بند تطويري ({cat==="أساسية"?"أساسية":cat==="عامة"?"عامة":"فنية"})
  </button>
  )}
   </div>
   );
  })}

  {/* د-9: الشهادة الاحترافية — للأدوار المستهدفة فقط */}
  {isCertEligible(user)&&(
  <div style={{background:"linear-gradient(135deg,#8B5CF60D,#6D28D908)",border:"1px solid #8B5CF630",borderRadius:14,padding:16,marginTop:14}}>
   <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
   <span style={{fontSize:20}}>🎖️</span>
   <div>
   <div style={{fontSize:14,fontWeight:900,color:"#7C3AED"}}>الشهادة الاحترافية</div>
   <div style={{fontSize:11,color:"#5B7A9E"}}>اختر شهادة احترافية واحدة تسعى للحصول عليها ضمن خطتك (اختياري)</div>
   </div>
   </div>
   {(()=>{
   const certList = getProfCerts().map(normCert);
   const curName = cert?.name||"";
   const isOther = cert?.isOther||false;
   const names = certList.map(c=>c.name);
   const selVal = isOther ? "__other__" : (names.includes(curName)?curName:(curName?"__other__":""));
   const selCert = certList.find(c=>c.name===curName);
   const setCertField = (patch) => setCert(prev=>({name:"",isOther:false,status:"none",targetDate:"",...(prev||{}),...patch}));
   const isApproved = !!approved; // حالة التنفيذ تظهر فقط بعد اعتماد الخطة
   return (
   <div style={{display:"flex",flexDirection:"column",gap:10}}>
   <div>
   <label style={lS}>🎖️ الشهادة</label>
   <select value={selVal} disabled={!canEditFields} onChange={e=>{
   const v=e.target.value;
   if(v==="") setCert(null);
   else if(v==="__other__") setCertField({name:"",isOther:true});
   else { const c=certList.find(x=>x.name===v); setCertField({name:v,isOther:false,category:c?.category,url:c?.url,cost:c?.cost}); }
   }} style={{...iS,color:selVal?"#15385C":"#8CA3BD"}}>
   <option value="">— بدون شهادة احترافية —</option>
   {certList.map((c,i)=><option key={i} value={c.name}>{c.category?`[${c.category}] `:""}{c.name}</option>)}
   <option value="__other__">✏️ أخرى (أكتبها بنفسي)...</option>
   </select>
   </div>
   {isOther&&(
   <div>
   <label style={lS}>✏️ اسم الشهادة</label>
   <input value={curName} readOnly={!canEditFields} onChange={e=>setCertField({name:e.target.value,isOther:true})} placeholder="اكتب اسم الشهادة الاحترافية..." style={iS}/>
   </div>
   )}
   {/* تفاصيل الشهادة المختارة من القائمة */}
   {selCert&&!isOther&&(selCert.url||selCert.cost)&&(
   <div style={{background:"#8B5CF608",border:"1px solid #8B5CF620",borderRadius:8,padding:"8px 12px",fontSize:11,color:"#5B7A9E"}}>
   {selCert.cost&&<span>💰 التكلفة: {selCert.cost}</span>}{selCert.cost&&selCert.url&&<span> • </span>}{isValidUrl(selCert.url)&&<a href={selCert.url} target="_blank" rel="noopener" style={{color:"#7C3AED"}}>🔗 تفاصيل الشهادة</a>}
   </div>
   )}
   {cert&&(cert.name||isOther)&&(
   <div>
   <label style={lS}>📅 تاريخ التنفيذ المتوقّع</label>
   <input type="date" value={cert.targetDate||""} readOnly={!canEditFields} onChange={e=>setCertField({targetDate:e.target.value})} style={iS}/>
   </div>
   )}
   {/* حالة التنفيذ — تظهر فقط بعد اعتماد الخطة */}
   {cert&&(cert.name||isOther)&&isApproved&&(
   <div>
   <label style={lS}>📊 حالة التنفيذ</label>
   <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
   {Object.entries(CERT_STATUS).map(([k,lbl])=>{
   const on = (cert.status||"none")===k;
   const col = CERT_STATUS_COLOR[k];
   return (
   <button key={k} onClick={()=>setCertField({status:k})}
   style={{flex:1,minWidth:90,padding:"9px 12px",borderRadius:10,border:`1.5px solid ${on?col:"#DDE9F5"}`,background:on?`${col}15`:"#fff",color:on?col:"#8CA3BD",fontSize:12,fontWeight:on?800:600,cursor:"pointer"}}>
   {k==="earned"?"🏅 ":k==="inprogress"?"⏳ ":"○ "}{lbl}
   </button>
   );
   })}
   </div>
   </div>
   )}
   {cert&&(cert.name||isOther)&&!isApproved&&(
   <div style={{fontSize:10,color:"#94A3B8",background:"#F1F5F9",borderRadius:8,padding:"6px 10px"}}>ℹ️ ستظهر «حالة التنفيذ» بعد اعتماد خطتك.</div>
   )}
   </div>
   );
   })()}
  </div>
  )}

  {idpPlan.length>0&&canEditFields&&!approved&&(
   <div style={{marginTop:8}}>
   <div style={{display:"flex",gap:8}}>
   <button onClick={saveDraft} style={{flex:1,padding:"12px",borderRadius:12,border:"1.5px solid #2E7FB8",background:"#2E7FB810",color:"#2E7FB8",fontWeight:700,fontSize:13,cursor:"pointer"}}>💾 حفظ مؤقت</button>
   <button onClick={saveAndClose} disabled={!planReadiness.ok} style={{flex:1,padding:"12px",borderRadius:12,border:"none",background:planReadiness.ok?"linear-gradient(135deg,#059669,#10B981)":"#CBD5E1",color:"#fff",fontWeight:700,fontSize:13,cursor:planReadiness.ok?"pointer":"not-allowed"}}>✅ حفظ وإغلاق التخطيط</button>
   </div>
   {!planReadiness.ok&&(
   <div style={{marginTop:8,background:"#F59E0B0D",border:"1px solid #F59E0B30",borderRadius:10,padding:"10px 12px",fontSize:11,color:"#B45309",lineHeight:1.9}}>
   ⚠️ لإتاحة «حفظ وإغلاق التخطيط» يلزم استكمال:
   {planReadiness.missingCats.length>0&&<div>• بند تطويري لكل فئة (ينقص: {planReadiness.missingCats.join("، ")})</div>}
   {planReadiness.incompleteCount>0&&<div>• إكمال كل حقول البنود (بنود ناقصة: {planReadiness.incompleteCount})</div>}
   {planReadiness.totalHours<minHours&&<div>• إجمالي ساعات التخطيط ≥ {minHours} ساعة (الحالي: {planReadiness.totalHours} ساعة)</div>}
   </div>
   )}
   </div>
  )}
  {idpPlan.length>0&&approved&&role!=="branch_mgr"&&(
   <div style={{marginTop:8,background:"#10B9810D",border:"1px solid #10B98130",borderRadius:10,padding:"10px 12px",fontSize:12,color:"#059669",fontWeight:700,textAlign:"center"}}>
   ✅ خطتك معتمدة ومقفلة — لا يمكن تعديلها. لأي تعديل، اطلب فتحها من المتابع الفني.
   </div>
  )}
  </div>
   )}
  </div>
  );
}
function ExecPanel({ user, onLogout }) {
  const [tab,setTab] = useState("summary"); // summary | mine
  const [users,setUsersState] = useState([]);
  const [evals,setEvalsState] = useState({});
  const [idps,setIdpsState] = useState({});
  const [impactData,setImpactData] = useState({});
  const [readings,setReadings] = useState({});
  const [locks,setLocks] = useState({});
  const [viewTarget,setViewTarget] = useState(null);
  const [evalWinData,setEvalWinData] = useState({branches:{}});
  const [toast,setToast] = useState(null);
  const showToast = (msg,c="#10B981") => { setToast({msg,c}); setTimeout(()=>setToast(null),2000); };

  useEffect(()=>{
  const loadData = ()=>{
  st.get("users_360c").then(u=>setUsersState(u||[]));
  st.get("evals_360c").then(d=>setEvalsState(d||{}));
  st.get("idps_360c").then(d=>setIdpsState(d||{}));
  st.get("impact_360c").then(d=>setImpactData(d||{}));
  st.get("readings_360c").then(d=>setReadings(d||{}));
  st.get("locks_360c").then(d=>setLocks(d||{}));
  st.get("evalwindow_360c").then(w=>setEvalWinData(w||{branches:{}}));
  st.getShared("customComps_360c").then(d=>{ if(d){ setActiveComps(d); COMPETENCIES_WITH_ITEMS=d; } });
  st.getShared("profCerts_360c").then(d=>{ if(d&&d.length){ setProfCerts(d); } });
  st.getShared("customJobs_360c").then(d=>{ if(d){ setActiveJobs(d); JOB_COMPETENCIES=d; } });
  st.getShared("customWeights_360c").then(d=>{ if(d){ setActiveWeights(d); if(d.employee||d.leader||d.specialist||d.branch_ext) applyCustomWeights(d); else applyCustomWeights({employee:d}); } });
  st.getShared("compRoleItems_360c").then(d=>{ if(d){ setCompRoleItems(d); } });
  setTimeout(()=>setUsersState(u=>[...u]), 300);
  };
  loadData();
  const onFocus=()=>loadData();
  window.addEventListener("focus",onFocus);
  const iv=setInterval(loadData,25000);
  return ()=>{ window.removeEventListener("focus",onFocus); clearInterval(iv); };
  },[]);

  const scope = getSummaryScope(user, users);
  const saveMyIdp = async (d) => { const ni={...idps,[user.id]:d}; setIdpsState(ni); await st.set("idps_360c",ni); showToast("✓ تم حفظ خطتك"); };
  const saveMySelfEval = async (s) => { const ne={...evals}; if(!ne[user.id])ne[user.id]={}; ne[user.id].self=s; setEvalsState(ne); await st.set("evals_360c",ne); showToast("✓ تم حفظ تقييمك"); };
  const subtypeLabel = user.roleSubtype && ROLE_SUBTYPES[user.role] ? ROLE_SUBTYPES[user.role][user.roleSubtype] : "";

  // تجميع ملخّص لكل شخص في النطاق
  const rows = scope.map(u=>{
   const st360 = getEmpFullStats(u, evals[u.id]||{});
   const idp = idps[u.id];
   return { u, score: st360?.avg??null, planApproved: idp?.approved, planRows: idp?.plan?.length||0 };
  }).sort((a,b)=>(b.score??-1)-(a.score??-1));

  return (
  <div style={{minHeight:"100vh",background:APP_BG,direction:"rtl",fontFamily:"'El Messiri',sans-serif"}}>
   <header style={{background:"rgba(255,255,255,0.82)",backdropFilter:"blur(14px)",borderBottom:"1px solid #C7DBF0",padding:"0 20px",position:"sticky",top:0,zIndex:100,boxShadow:"0 4px 18px rgba(46,127,184,0.08)"}}>
   <div style={{maxWidth:1100,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",height:54}}>
   <div style={{display:"flex",alignItems:"center",gap:10}}>
   <LogoImg style={{height:32}} size={15}/>
   <div><div style={{fontWeight:900,fontSize:15,color:"#15385C",letterSpacing:"-0.3px"}}>{ROLES_LIST[user.role]}</div><div style={{fontSize:10,color:"#5B7A9E"}}>{user.name}{subtypeLabel?` • ${subtypeLabel}`:""}</div></div>
   </div>
   <div style={{display:"flex",gap:6}}>
   <ChangePasswordButton userId={user.id} currentPassword={user.password}/>
   <RefreshButton/><button onClick={onLogout} style={{padding:"5px 12px",borderRadius:20,border:"1px solid #EF444430",background:"#EF444410",color:"#EF4444",fontSize:11,cursor:"pointer",marginRight:6}}>خروج</button>
   </div>
   </div>
   </header>
   <main style={{maxWidth:1100,margin:"0 auto",padding:"20px 16px"}}>
   <div style={{display:"flex",gap:6,marginBottom:18,flexWrap:"wrap"}}>
   {[{k:"summary",l:"📊 ملخّص الأداء",c:"#10B981"},{k:"mine",l:"🎯 خطتي وتقييمي",c:"#8B5CF6"}].map(t=>(
   <button key={t.k} onClick={()=>setTab(t.k)} style={{flex:"1 1 auto",minWidth:150,padding:"13px 18px",borderRadius:24,border:"none",background:tab===t.k?`linear-gradient(135deg,${t.c},${t.c}cc)`:"#fff",color:tab===t.k?"#fff":"#5B7A9E",fontSize:13,fontWeight:800,cursor:"pointer",boxShadow:tab===t.k?`0 8px 22px ${t.c}45`:"0 2px 10px rgba(46,127,184,0.08)"}}>{t.l}</button>
   ))}
   </div>

   {tab==="summary"&&(
   <div>
   <div style={{background:"#FFFFFF",border:"1px solid #10B98125",borderRadius:12,padding:"14px 18px",marginBottom:14}}>
   <div style={{fontSize:14,fontWeight:900,color:"#059669"}}>📊 ملخّص أداء نطاقك الإشرافي</div>
   <div style={{fontSize:11,color:"#5B7A9E",marginTop:2}}>{scope.length} شخصاً ضمن نطاق متابعتك</div>
   </div>
   {rows.length===0?(
   <div style={{textAlign:"center",padding:40,color:"#5B7A9E",background:"#fff",borderRadius:12}}>لا يوجد أشخاص ضمن نطاقك بعد.</div>
   ):rows.map(({u,score,planApproved,planRows})=>{
   const lv = score!=null?getLevel(score):null;
   return (
   <div key={u.id} style={{background:"#fff",border:"1px solid #DDE9F5",borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
   <div style={{flex:1}}>
   <div style={{fontWeight:700,fontSize:12,color:"#1E293B"}}>{u.name}</div>
   <div style={{fontSize:10,color:"#5B7A9E"}}>{ROLES_LIST[u.role]}{u.roleSubtype&&ROLE_SUBTYPES[u.role]?` • ${ROLE_SUBTYPES[u.role][u.roleSubtype]||""}`:""}{u.branch?` • ${u.branch}`:""}</div>
   </div>
   {planRows>0&&<span style={{fontSize:10,color:planApproved?"#059669":"#F59E0B",background:planApproved?"#10B98112":"#F59E0B12",padding:"3px 8px",borderRadius:20}}>{planApproved?"خطة معتمدة":"خطة قيد الاعتماد"}</span>}
   {lv?(
   <div style={{background:`${lv.color}15`,borderRadius:8,padding:"3px 10px",display:"flex",gap:6,alignItems:"center"}}>
   <span style={{fontSize:12,fontWeight:900,color:lv.color,fontFamily:MONO}}>{score.toFixed(2)}</span>
   <span style={{fontSize:9,color:lv.color}}>{lv.label}</span>
   </div>
   ):<span style={{fontSize:10,color:"#8CA3BD"}}>لم يُقيَّم</span>}
   <button onClick={()=>setViewTarget(u)} style={{padding:"6px 12px",borderRadius:8,border:"1px solid #3B82F630",background:"#3B82F612",color:"#3B82F6",fontSize:11,cursor:"pointer",fontWeight:700}}>عرض</button>
   </div>
   );
   })}
   </div>
   )}

   {tab==="mine"&&(
   <MyPlanAndEval user={user} idps={idps} evals={evals} impactData={impactData} readings={readings} locks={locks} setLocks={setLocks} evalWinData={evalWinData}
   onSaveIdp={saveMyIdp} onSaveSelfEval={saveMySelfEval} onSaveReadings={async d=>{setReadings(d);await st.set("readings_360c",d);}} showToast={showToast}/>
   )}
   </main>
   {viewTarget&&<Card360 targetUser={viewTarget} empEval={evals[viewTarget.id]||{}} idpData={idps[viewTarget.id]} readings={readings} onSaveReadings={async d=>{setReadings(d);await st.set("readings_360c",d);}} currentUser={user} allEvals={evals} allUsers={users} approvals={approvals} onClose={()=>setViewTarget(null)}/>}
   {toast&&<div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",background:toast.c,color:"#fff",padding:"10px 22px",borderRadius:24,fontSize:13,fontWeight:700,zIndex:900}}>{toast.msg}</div>}
  </div>
  );
}

// ملاحظة 9: تبويبات متابعة مدير الإدارة (أخصائيو إدارته + الامتدادات الفنية)
// يعتمد خططهم، ويقيّمهم: الأخصائي كمدير مباشر، والامتداد كمتابع فني.
function DeptManagerTeam({ user, users, evals, idps, readings, impactData, locks, setLocks, onApprovePlan, onSaveEval, onOpenCard, showToast }) {
  const [sub,setSub] = useState("growth"); // growth | eval
  const [evalTarget,setEvalTarget] = useState(null);
  // تابعو الإدارة: أخصائيون + امتدادات فنية بنفس النوع الفرعي
  const team = (users||[]).filter(u=>u.id!==user.id && (u.role==="specialist"||u.role==="branch_ext") && u.roleSubtype===user.roleSubtype);
  const specialists = team.filter(u=>u.role==="specialist");
  const extensions = team.filter(u=>u.role==="branch_ext");
  // الطرف الذي يقيّمه مدير الإدارة: للأخصائي = stage_mgr (مدير مباشر)، للامتداد = supervisor (متابع فني)
  const partyFor = (u)=> u.role==="specialist" ? "stage_mgr" : "supervisor";

  return (
  <div>
   <div style={{display:"flex",gap:6,marginBottom:16}}>
   {[{k:"growth",l:"👥 تطوّر فريقي",c:"#10B981"},{k:"eval",l:"📋 تقييم فريقي",c:"#3B82F6"}].map(t=>(
   <button key={t.k} onClick={()=>setSub(t.k)} style={{flex:1,padding:"11px",borderRadius:12,border:"none",background:sub===t.k?`linear-gradient(135deg,${t.c},${t.c}cc)`:"#fff",color:sub===t.k?"#fff":"#5B7A9E",fontSize:13,fontWeight:800,cursor:"pointer",boxShadow:sub===t.k?`0 6px 18px ${t.c}40`:"0 2px 8px rgba(46,127,184,0.07)"}}>{t.l}</button>
   ))}
   </div>

   {team.length===0&&(
   <div style={{textAlign:"center",padding:36,color:"#5B7A9E",background:"#fff",borderRadius:12}}>لا يوجد أخصائيون أو امتدادات فنية في إدارتك بعد.</div>
   )}

   {sub==="growth"&&team.length>0&&(
   <div>
   <LeaderPlanApprovals user={user} users={users} idps={idps} impactData={impactData} readings={readings}
    onApprovePlan={onApprovePlan} onOpenCard={onOpenCard}/>
   {/* قائمة الفريق مع حالة الخطة */}
   {[{list:specialists,label:"👤 أخصائيو الإدارة"},{list:extensions,label:"🔗 الامتدادات الفنية في الفروع"}].map(grp=>grp.list.length>0&&(
   <div key={grp.label} style={{marginTop:14}}>
   <div style={{fontSize:13,fontWeight:800,color:"#5B7A9E",marginBottom:8}}>{grp.label} ({grp.list.length})</div>
   {grp.list.map(u=>{
   const idp = idps[u.id]; const approved = idp?.approved;
   return (
   <div key={u.id} style={{background:"#fff",border:"1px solid #DDE9F5",borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
   <div style={{flex:1}}>
   <div style={{fontWeight:700,fontSize:12,color:"#1E293B"}}>{u.name}</div>
   <div style={{fontSize:10,color:"#5B7A9E"}}>{u.job||ROLES_LIST[u.role]}{u.branch?` • ${u.branch}`:""}</div>
   </div>
   {idp?.plan?.length>0&&<span style={{fontSize:10,color:approved?"#059669":"#F59E0B",background:approved?"#10B98112":"#F59E0B12",padding:"3px 8px",borderRadius:20}}>{approved?"خطة معتمدة":"بانتظار الاعتماد"}</span>}
   <button onClick={()=>onOpenCard(u)} style={{padding:"6px 12px",borderRadius:8,border:"1px solid #3B82F630",background:"#3B82F612",color:"#3B82F6",fontSize:11,cursor:"pointer",fontWeight:700}}>عرض</button>
   </div>
   );
   })}
   </div>
   ))}
   </div>
   )}

   {sub==="eval"&&team.length>0&&(
   <div>
   <div style={{background:"#3B82F60D",border:"1px solid #3B82F625",borderRadius:10,padding:"10px 14px",marginBottom:12,fontSize:11,color:"#5B7A9E",lineHeight:1.7}}>
   💡 تقيّم <strong style={{color:"#3B82F6"}}>الأخصائيين</strong> بصفتك مديرهم المباشر، و<strong style={{color:"#3B82F6"}}>الامتدادات الفنية</strong> بصفتك متابعهم الفني.
   </div>
   {team.map(u=>{
   const party = partyFor(u);
   const done = Object.keys((evals[u.id]||{})[party]||{}).length>0;
   return (
   <div key={u.id} style={{background:"#fff",border:`1px solid ${done?"#10B98130":"#DDE9F5"}`,borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
   <div style={{flex:1}}>
   <div style={{fontWeight:700,fontSize:12,color:"#1E293B"}}>{u.name}</div>
   <div style={{fontSize:10,color:"#5B7A9E"}}>{ROLES_LIST[u.role]}{u.branch?` • ${u.branch}`:""} • تقييمك بصفتك: {party==="stage_mgr"?"مدير مباشر":"متابع فني"}</div>
   </div>
   {done&&<span style={{fontSize:10,color:"#059669"}}>✓ تم</span>}
   <button onClick={()=>setEvalTarget({user:u,party})} style={{padding:"6px 14px",borderRadius:8,border:done?"1px solid #10B98130":"none",background:done?"#10B98115":"linear-gradient(135deg,#2563EB,#3B82F6)",color:done?"#10B981":"#fff",fontSize:11,cursor:"pointer",fontWeight:700}}>{done?"تعديل":"تقييم ▶"}</button>
   <button onClick={()=>onOpenCard(u)} style={{padding:"6px 12px",borderRadius:8,border:"1px solid #DDE9F5",background:"transparent",color:"#5B7A9E",fontSize:11,cursor:"pointer"}}>عرض</button>
   </div>
   );
   })}
   </div>
   )}

   {evalTarget&&<EvalForm partyKey={evalTarget.party} targetUser={evalTarget.user} existingScores={(evals[evalTarget.user.id]||{})[evalTarget.party]||{}} onSave={async s=>{await onSaveEval(evalTarget.user.id,evalTarget.party,s);setEvalTarget(null);}} onCancel={()=>setEvalTarget(null)} locks={locks} onLock={async(key)=>{const nl={...(locks||{}),[key]:{lockedAt:new Date().toISOString()}};setLocks(nl);await st.set('locks_360c',nl);}}/>}
  </div>
  );
}

function EmployeePanel({ user, onLogout }) {
  const [empTab,setEmpTab] = useState("growth"); // eval | growth | accounts
  const [evals,setEvalsState] = useState({});
  const [users,setUsersState] = useState([]);
  const [idps,setIdpsState] = useState({});
  const [acctRequests,setAcctRequests] = useState([]); // ج-1: لمدير الإدارة
  const canReqAccounts = user.role==="dept_mgr"; // مدير الإدارة يطلب حسابات إدارته
  const isDeptMgr = user.role==="dept_mgr"; // ملاحظة 9: يتابع أخصائيي إدارته والامتدادات الفنية
  const [selfTarget,setSelfTarget] = useState(null);
  const [peerTarget,setPeerTarget] = useState(null);
  const [roleEvalTarget,setRoleEvalTarget] = useState(null); // {user, party}
  const [evalWinAll,setEvalWinAll] = useState({branches:{}});
  const [viewCard,setViewCard] = useState(false);
  const [teamCardTarget,setTeamCardTarget] = useState(null); // ملاحظة 9: بطاقة عضو فريق مدير الإدارة
  const [evalWindowData,setEvalWindowData] = useState({isOpen:false});
  const [readings,setReadings] = useState({});
  const [impactData,setImpactData] = useState({});
  const [locks,setLocks] = useState({});
  const [approvals,setApprovals] = useState({});
  const [toast,setToast] = useState(null);
  const [loaded,setLoaded] = useState(false);

  const showToast = (msg,c="#10B981") => { setToast({msg,c}); setTimeout(()=>setToast(null),2000); };

  useEffect(()=>{
  Promise.all([st.get("users_360c"),st.get("evals_360c"),st.get("idps_360c"),st.get("evalwindow_360c"),st.get("readings_360c"),st.get("locks_360c"),st.get("approvals_360c"),st.get("impact_360c")]).then(([u,e,i,w,r,l,a,im])=>{
   // نافذة التقييم تُخزَّن لكل فرع؛ نستخرج نافذة فرع هذا الموظف، ونحفظ الكل لتقييم أطراف من فروع أخرى
   const myWin = (w&&w.branches) ? (w.branches[user.branch]||{isOpen:false}) : (w||{isOpen:false});
   setUsersState(u||[]); setEvalsState(e||{}); setIdpsState(i||{}); setEvalWindowData(myWin); setEvalWinAll(w||{branches:{}}); setReadings(r||{}); setLocks(l||{}); setApprovals(a||{}); setImpactData(im||{}); setLoaded(true);
  });
  if (canReqAccounts) st.get("acctRequests_360c").then(d=>setAcctRequests(Array.isArray(d)?d:[]));
  Promise.all([st.get("round2_360c"),st.get("twiceeval_360c")]).then(([r2,tw])=>setRound2Ctx(r2?.open,tw||[])); // ب-4
  },[]);
  // ج-1: إرسال طلب فتح حساب (مدير الإدارة)
  const submitAcctRequest = async (payload) => {
  const req = { ...payload, id:(typeof crypto!=="undefined"&&crypto.randomUUID?crypto.randomUUID():String(Date.now())), status:"pending", requesterId:user.id, requesterName:user.name, createdAt:new Date().toISOString().split("T")[0] };
  const nr = [req, ...acctRequests];
  setAcctRequests(nr); await st.set("acctRequests_360c",nr);
  showToast("📨 أُرسل الطلب لمدير النظام");
  };
  // ملاحظة 9: اعتماد خطط الفريق + تقييمهم (مدير الإدارة)
  const approveTeamPlan = async (targetId, approve) => {
  const cur = idps[targetId]||{};
  const ni = {...idps,[targetId]:{...cur, approved:approve, approvedBy:approve?user.name:null, approvedAt:approve?new Date().toISOString().split("T")[0]:null}};
  setIdpsState(ni); await st.set("idps_360c",ni);
  showToast(approve?"✅ اعتُمدت الخطة":"↩ أُلغي الاعتماد");
  };
  const saveTeamEval = async (targetId, party, scores) => {
  const ne={...evals}; if(!ne[targetId])ne[targetId]={}; ne[targetId][party]=scores;
  setEvalsState(ne); await st.set("evals_360c",ne);
  showToast("✓ تم حفظ التقييم");
  };

  const myEval = (evals[user.id]||{});
  const selfAllowedCats = PARTY_CATS["self"];
  const myComps = (getActiveJobs()[user.job]||[]).filter(c=>selfAllowedCats.includes(getCat(c)));
  const selfDone = myComps.some(c=>Object.values(myEval.self?.[c]||{}).some(v=>v>0));

  const peerTargets = (users||[]).filter(u=>u.id!==user.id && (u.peerIds||(u.peerId?[u.peerId]:[])).includes(user.id));
  // الرؤساء الذين يقيّمهم المستخدم الحالي كمرؤوس (التقييم الصاعد)
  const bossTargets = (users||[]).filter(t=>{
    if (t.id===user.id) return false;
    if (getEvalModel(t)!=="leader") return false;       // فقط القياديون لهم مرؤوسون
    return getEvaluators(t, users).some(e=>e.id===user.id);   // هل أنا من مُقيّميه؟
  });
  // مقدّمو الخدمة الذين يقيّمهم المستخدم كمستفيد
  const serviceTargets = (users||[]).filter(t=>{
    if (t.id===user.id) return false;
    const m = getEvalModel(t);
    if (m!=="branch_ext" && m!=="specialist") return false;  // من لهم مستفيدون
    return getEvaluators(t, users).some(e=>e.id===user.id);
  });

  const saveSelfEval = async scores => {
  const ne={...evals}; if (!ne[user.id]) ne[user.id]={}; ne[user.id]={...ne[user.id]};
  writePartyScore(ne[user.id], "self", scores, user.id);
  setEvalsState(ne); await st.set("evals_360c",ne); setSelfTarget(null); showToast(isR2Active(user.id)?"✓ حُفظ (التقييم الثاني)":"✓ تم حفظ تقييمك الذاتي");
  };
  const savePeerEval = async (targetId, scores) => {
  const ne={...evals}; if (!ne[targetId]) ne[targetId]={}; ne[targetId]={...ne[targetId]};
  const bucket = isR2Active(targetId) ? (ne[targetId].__r2={...(ne[targetId].__r2||{})}) : ne[targetId];
  const raters = {...(bucket.peerRaters||{})}; raters[user.id]=scores;
  bucket.peerRaters = raters; bucket.peer = computePeerAvg(raters);
  setEvalsState(ne); await st.set("evals_360c",ne); setPeerTarget(null); showToast("✓ تم حفظ تقييم الزميل");
  };
  // حفظ تقييم المرؤوسين/المستفيدين (party = subordinate | beneficiary) — نفس نمط الزملاء
  const saveRoleEval = async (targetId, party, scores) => {
  const ne={...evals}; if (!ne[targetId]) ne[targetId]={}; ne[targetId]={...ne[targetId]};
  const bucket = isR2Active(targetId) ? (ne[targetId].__r2={...(ne[targetId].__r2||{})}) : ne[targetId];
  const ratersKey = party+"Raters";
  const raters = {...(bucket[ratersKey]||{})}; raters[user.id]=scores;
  bucket[ratersKey] = raters; bucket[party] = computePeerAvg(raters);
  setEvalsState(ne); await st.set("evals_360c",ne);
  showToast(party==="subordinate"?"✓ تم حفظ تقييم الرئيس":"✓ تم حفظ تقييم مقدّم الخدمة");
  };
  const saveIdp = async data => {
  const ni={...idps,[user.id]:data}; setIdpsState(ni); await st.set("idps_360c",ni); showToast("✓ تم حفظ الخطة");
  };

  if (!loaded) return <div style={{minHeight:"100vh",background:APP_BG,display:"flex",alignItems:"center",justifyContent:"center",color:"#5B7A9E",direction:"rtl"}}>جاري التحميل...</div>;

  // إصلاح: نعرض فقط أطراف التقييم الفعلية لدور هذا الموظف (لا المرؤوسين/المستفيدين لمن لا يخصّونه)
  const myRoleParties = partiesForRole(user);
  const partyStatus = EVAL_PARTIES.filter(p=>myRoleParties.includes(p.key)).map(p=>{
  const allowedCats=PARTY_CATS[p.key]||[];
  const myC=(getActiveJobs()[user.job]||[]).filter(c=>allowedCats.includes(getCat(c)));
  const done = myC.some(c=>Object.values(myEval[p.key]?.[c]||{}).some(v=>v>0));
  return {...p,done};
  });

  return (
  <div style={{minHeight:"100vh",background:APP_BG,fontFamily:"'El Messiri',sans-serif",direction:"rtl",color:"#1E293B"}}>
   <link href="https://fonts.googleapis.com/css2?family=El+Messiri:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet"/>
   {toast&&<div style={{position:"fixed",top:18,left:"50%",transform:"translateX(-50%)",background:toast.c,color:"#fff",padding:"11px 26px",borderRadius:30,fontWeight:700,fontSize:13,zIndex:9999,boxShadow:`0 8px 28px ${toast.c}55`,animation:"fadeInUp 0.3s ease"}}>{toast.msg}</div>}

   <header style={{background:"rgba(255,255,255,0.82)",backdropFilter:"blur(14px)",borderBottom:"1px solid #C7DBF0",padding:"0 20px",position:"sticky",top:0,zIndex:100,boxShadow:"0 4px 18px rgba(46,127,184,0.08)"}}>
  <div style={{maxWidth:860,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",height:54}}>
  <div style={{display:"flex",alignItems:"center",gap:10}}>
   <LogoImg style={{height:32}} size={15}/>
   <div><div style={{fontWeight:900,fontSize:13}}>ملف التطور المهني</div><div style={{fontSize:10,color:"#5B7A9E"}}>{user.name} • {user.job}{user.branch?` • 🏛️ ${user.branch}`:""}{user.stage?` • 📚 ${user.stage}`:""}{(()=>{const sup=(users||[]).find(u=>u.id===user.supervisorId);return sup?` • 🔍 المتابع الفني: ${sup.name}${sup.supervisorType?` (${sup.supervisorType})`:""}`:"";})()}</div></div>
  </div>
  <div style={{display:"flex",gap:6,alignItems:"center"}}>
   <ChangePasswordButton userId={user.id} currentPassword={user.password} compact/>
   <RefreshButton/><button onClick={onLogout} style={{padding:"4px 12px",borderRadius:20,border:"1px solid #EF444430",background:"#EF444410",color:"#EF4444",fontSize:11,cursor:"pointer",marginRight:6}}>خروج</button>
  </div>
  </div>
   </header>

   <main className="print-area" style={{maxWidth:860,margin:"0 auto",padding:"20px 16px"}}>
  {/* التبويبان الرئيسيان */}
  <div style={{display:"flex",gap:8,marginBottom:16}}>
  {[{k:"growth",l:"🎯 خطة التطور المهني",c:"#10B981"},{k:"eval",l:"📊 تقييم الأداء الوظيفي",c:"#3B82F6"},...(isDeptMgr?[{k:"team",l:"👥 متابعة فريقي",c:"#0891B2"}]:[]),...(canReqAccounts?[{k:"accounts",l:"➕ طلبات الحسابات",c:"#EC4899"}]:[])].map(t=>(
   <button key={t.k} onClick={()=>setEmpTab(t.k)}
   style={{flex:1,padding:"14px 18px",borderRadius:24,border:"none",background:empTab===t.k?`linear-gradient(135deg,${t.c},${t.c}cc)`:"#fff",color:empTab===t.k?"#fff":"#5B7A9E",fontSize:14,fontWeight:800,cursor:"pointer",boxShadow:empTab===t.k?`0 8px 22px ${t.c}45`:"0 2px 10px rgba(46,127,184,0.08)"}}>
   {t.l}
   </button>
  ))}
  </div>

  {empTab==="eval"&&(<>
  {(()=>{const ap=approvals[`${user.branch}__${user.stage}__eval`];return ap?.approved?(
  <div style={{background:"#10B98112",border:"1px solid #10B98140",borderRadius:12,padding:"12px 16px",marginBottom:14,display:"flex",alignItems:"center",gap:10}}>
   <span style={{fontSize:22}}>✅</span>
   <div><div style={{fontSize:13,fontWeight:900,color:"#10B981"}}>نتيجة تقييم الأداء معتمدة من مدير الفرع</div><div style={{fontSize:10,color:"#5B7A9E",marginTop:2}}>بدأت مرحلة قراءة النتائج مع المتابع الفني ومدير المرحلة{ap.at?` • ${ap.at}`:""}</div></div>
  </div>
  ):null;})()}
  {/* حالة التقييمات */}
  <div style={{background:BRAND.cardBg,border:`1px solid ${BRAND.cardBorder}`,borderRadius:20,boxShadow:"0 8px 26px rgba(46,127,184,0.10)",padding:20,marginBottom:16}}>
  <div style={{fontSize:13,color:"#2E7FB8",fontWeight:700,marginBottom:12}}>◆ حالة تقييمي الشامل 360°</div>
  <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8}}>
   {partyStatus.map(p=>(
   <div key={p.key} style={{background:p.done?`${p.color}10`:"#F4F9FE",border:`1px solid ${p.done?p.color+"35":"#DDE9F5"}`,borderRadius:10,padding:"10px 14px"}}>
  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
  <span style={{fontSize:12,fontWeight:700}}>{p.icon} {p.label}</span>
  {p.done&&<span style={{fontSize:10,color:p.color}}>✓ مكتمل</span>}
  </div>
  <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:4}}>
  {p.cats.map(cat=>(
  <span key={cat} style={{fontSize:9,padding:"1px 7px",borderRadius:20,background:`${CAT_COLORS[cat]}12`,color:CAT_COLORS[cat],border:`1px solid ${CAT_COLORS[cat]}20`}}>
  {cat} {PARTY_CAT_WEIGHTS[p.key][cat]}%
  </span>
  ))}
  </div>
  {!p.done&&<div style={{fontSize:10,color:"#1E293B",marginTop:4}}>⏳ في الانتظار</div>}
   </div>
   ))}
  </div>
  </div>

  {/* بنر حالة التقييم */}
  {(()=>{
  const today = new Date().toISOString().split("T")[0];
  const w = evalWindowData;
  const isExpired = w.closeDate && w.closeDate < today;
  const isOpen = w.isOpen && !isExpired;
  return (
   <div style={{background:isOpen?"#10B98112":"#EF444412",border:`1px solid ${isOpen?"#10B98130":"#EF444430"}`,borderRadius:12,padding:"12px 16px",marginBottom:16,display:"flex",gap:10,alignItems:"flex-start"}}>
   <span style={{fontSize:20}}>{isOpen?"🔓":"🔒"}</span>
   <div>
  <div style={{fontSize:12,fontWeight:700,color:isOpen?"#10B981":"#EF4444"}}>{isOpen?"التقييم مفتوح":"التقييم مغلق حالياً"}</div>
  {w.openDate&&<div style={{fontSize:11,color:"#5B7A9E",marginTop:2}}>{w.openDate&&`من: ${w.openDate}`}{w.closeDate&&` ← حتى: ${w.closeDate}`}</div>}
  {w.note&&<div style={{fontSize:11,color:"#5B7A9E",marginTop:2}}>{w.note}</div>}
  {isExpired&&<div style={{fontSize:11,color:"#F59E0B",marginTop:2}}>⌛ انتهت مدة التقييم</div>}
  {!isOpen&&!isExpired&&<div style={{fontSize:11,color:"#5B7A9E",marginTop:2}}>يرجى التواصل مع قسم التدريب - الموارد البشرية</div>}
   </div>
   </div>
  );
  })()}
  {/* أزرار */}
  {(()=>{
  const today = new Date().toISOString().split("T")[0];
  const w = evalWindowData;
  const winOpen = w.isOpen && !(w.closeDate && w.closeDate < today);
  return (
  <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
  {(()=>{
   const selfLocked = locks[`${user.id}__self`];
   if (selfLocked) return (
   <div style={{flex:1,minWidth:150,padding:"12px",borderRadius:12,background:"#EF444410",border:"2px solid #EF444430",color:"#EF4444",fontWeight:700,fontSize:13,textAlign:"center"}}>🔒 التقييم الذاتي مقفول</div>
   );
   if (!winOpen) return (
   <div style={{flex:1,minWidth:150,padding:"12px",borderRadius:12,background:"#F1F5F9",border:"2px solid #E2E8F0",color:"#94A3B8",fontWeight:700,fontSize:13,textAlign:"center"}}>🔒 التقييم مغلق — لا يمكن {selfDone?"التعديل":"البدء"}</div>
   );
   return (
   <button onClick={()=>setSelfTarget(user)} style={{flex:1,minWidth:150,padding:"12px",borderRadius:12,border:selfDone?`1px solid #10B98140`:"none",background:selfDone?"#10B98115":"linear-gradient(135deg,#059669,#10B981)",color:selfDone?"#10B981":"#fff",fontWeight:700,fontSize:13,cursor:"pointer"}}>
  {selfDone?"✏️ تعديل تقييمي الذاتي":"📝 ابدأ تقييمي الذاتي"}
   </button>
   );
  })()}
  <button onClick={()=>setViewCard(true)} style={{flex:1,minWidth:150,padding:"12px",borderRadius:12,border:"1px solid #3B82F630",background:"#3B82F615",color:"#3B82F6",fontWeight:700,fontSize:13,cursor:"pointer"}}>
   📊 عرض بطاقتي الكاملة
  </button>
  </div>
  );
  })()}

  {/* تقييم الزملاء */}
  {peerTargets.length>0&&(
  <div style={{background:"#FFFFFF",border:"1px solid #8B5CF625",borderRadius:14,padding:16}}>
   <div style={{fontSize:13,color:"#8B5CF6",fontWeight:700,marginBottom:8}}>🤝 تقييم الزملاء (الجدارات الأساسية فقط — 5%)</div>
   {peerTargets.map(t=>{
   const done = (getActiveJobs()[t.job]||[]).filter(c=>getCat(c)==="أساسية").some(c=>Object.values(((evals[t.id]||{}).peerRaters?.[user.id])?.[c]||{}).some(v=>v>0));
   return (
  <div key={t.id} style={{background:"#F4F9FE",border:`1px solid ${done?"#8B5CF630":"#DDE9F5"}`,borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
  <div style={{flex:1}}>
  <div style={{fontWeight:600,fontSize:12,color:"#1E293B"}}>{t.name}</div>
  <div style={{fontSize:11,color:"#5B7A9E"}}>{t.job}</div>
  {done&&<div style={{fontSize:10,color:"#8B5CF6",marginTop:2}}>✓ تم التقييم</div>}
  </div>
  {(()=>{ const ws=branchWindowStatus(evalWinAll,t.branch); return (!ws.open&&!done)
  ? <span style={{padding:"6px 12px",borderRadius:8,background:"#F1F5F9",border:"1px solid #E2E8F0",color:"#94A3B8",fontSize:11,fontWeight:700}} title="نافذة تقييم فرع الزميل مغلقة">🔒 مغلق</span>
  : <button onClick={()=>ws.open&&setPeerTarget(t)} disabled={!ws.open}
  style={{padding:"6px 14px",borderRadius:8,border:done?"1px solid #8B5CF630":"none",background:done?"#8B5CF615":ws.open?"linear-gradient(135deg,#6D28D9,#8B5CF6)":"#CBD5E1",color:done?"#8B5CF6":"#fff",fontSize:11,cursor:ws.open?"pointer":"not-allowed",fontWeight:700}}>
  {done?"تعديل":"تقييم ▶"}
  </button>;
  })()}
  </div>
   );
   })}
  </div>
  )}

  {/* تقييم الرؤساء (التقييم الصاعد) */}
  {bossTargets.length>0&&(
  <div style={{background:"#FFFFFF",border:"1px solid #8B5CF625",borderRadius:14,padding:16,marginTop:12}}>
   <div style={{fontSize:13,color:"#8B5CF6",fontWeight:700,marginBottom:8}}>⬆️ تقييم الرؤساء المباشرين</div>
   {bossTargets.map(t=>{
   const done = Object.values((evals[t.id]||{}).subordinateRaters?.[user.id]||{}).some(cs=>Object.values(cs).some(v=>v>0));
   return (
   <div key={t.id} style={{background:"#F4F9FE",border:`1px solid ${done?"#8B5CF630":"#DDE9F5"}`,borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
   <div style={{flex:1}}>
   <div style={{fontWeight:600,fontSize:12,color:"#1E293B"}}>{t.name}</div>
   <div style={{fontSize:11,color:"#5B7A9E"}}>{ROLES_LIST[t.role]}{t.roleSubtype&&ROLE_SUBTYPES[t.role]?` • ${ROLE_SUBTYPES[t.role][t.roleSubtype]||""}`:""}</div>
   {done&&<div style={{fontSize:10,color:"#8B5CF6",marginTop:2}}>✓ تم التقييم</div>}
   </div>
   <button onClick={()=>setRoleEvalTarget({user:t,party:"subordinate"})} style={{padding:"6px 14px",borderRadius:8,border:done?"1px solid #8B5CF630":"none",background:done?"#8B5CF615":"linear-gradient(135deg,#6D28D9,#8B5CF6)",color:done?"#8B5CF6":"#fff",fontSize:11,cursor:"pointer",fontWeight:700}}>{done?"تعديل":"تقييم ▶"}</button>
   </div>
   );
   })}
  </div>
  )}

  {/* تقييم مقدّمي الخدمة (المستفيدون) */}
  {serviceTargets.length>0&&(
  <div style={{background:"#FFFFFF",border:"1px solid #0891B225",borderRadius:14,padding:16,marginTop:12}}>
   <div style={{fontSize:13,color:"#0891B2",fontWeight:700,marginBottom:8}}>🎯 تقييم مقدّمي الخدمة</div>
   {serviceTargets.map(t=>{
   const done = Object.values((evals[t.id]||{}).beneficiaryRaters?.[user.id]||{}).some(cs=>Object.values(cs).some(v=>v>0));
   return (
   <div key={t.id} style={{background:"#F4F9FE",border:`1px solid ${done?"#0891B230":"#DDE9F5"}`,borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
   <div style={{flex:1}}>
   <div style={{fontWeight:600,fontSize:12,color:"#1E293B"}}>{t.name}</div>
   <div style={{fontSize:11,color:"#5B7A9E"}}>{ROLES_LIST[t.role]}{t.roleSubtype&&ROLE_SUBTYPES[t.role]?` • ${ROLE_SUBTYPES[t.role][t.roleSubtype]||""}`:""}</div>
   {done&&<div style={{fontSize:10,color:"#0891B2",marginTop:2}}>✓ تم التقييم</div>}
   </div>
   {(()=>{ const ws=branchWindowStatus(evalWinAll,t.branch); return (!ws.open&&!done)
   ? <span style={{padding:"6px 12px",borderRadius:8,background:"#F1F5F9",border:"1px solid #E2E8F0",color:"#94A3B8",fontSize:11,fontWeight:700}} title="نافذة تقييم فرع هذا الشخص مغلقة">🔒 مغلق</span>
   : <button onClick={()=>ws.open&&setRoleEvalTarget({user:t,party:"beneficiary"})} disabled={!ws.open} style={{padding:"6px 14px",borderRadius:8,border:done?"1px solid #0891B230":"none",background:done?"#0891B215":ws.open?"linear-gradient(135deg,#0E7490,#0891B2)":"#CBD5E1",color:done?"#0891B2":"#fff",fontSize:11,cursor:ws.open?"pointer":"not-allowed",fontWeight:700}}>{done?"تعديل":"تقييم ▶"}</button>;
   })()}
   </div>
   );
   })}
  </div>
  )}
  </>)}

  {empTab==="growth"&&(
  <EmployeeGrowthPlan
   user={user}
   empEval={evals[user.id]||{}}
   idpData={idps[user.id]}
   onSave={saveIdp}
   viewerRole="employee"
  />
  )}

  {/* ج-1: طلبات الحسابات (مدير الإدارة) */}
  {/* ملاحظة 9: متابعة فريق مدير الإدارة */}
  {empTab==="team"&&isDeptMgr&&(
  <DeptManagerTeam user={user} users={users} evals={evals} idps={idps} readings={readings} impactData={impactData}
   locks={locks} setLocks={setLocks} onApprovePlan={approveTeamPlan} onSaveEval={saveTeamEval}
   onOpenCard={(u)=>{ setTeamCardTarget(u); }} showToast={showToast}/>
  )}

  {empTab==="accounts"&&canReqAccounts&&(
  <div>
   <RequestAccountForm user={user} onSubmit={submitAcctRequest}/>
   <div style={{marginTop:16}}>
   <div style={{fontSize:13,fontWeight:800,color:"#5B7A9E",marginBottom:8}}>📋 طلباتي ({acctRequests.filter(r=>r.requesterId===user.id).length})</div>
   {acctRequests.filter(r=>r.requesterId===user.id).length===0?(
   <div style={{textAlign:"center",padding:28,color:"#8CA3BD",background:"#fff",borderRadius:12,fontSize:12}}>لا طلبات بعد.</div>
   ):acctRequests.filter(r=>r.requesterId===user.id).map(r=>{
   const col = r.status==="approved"?"#10B981":r.status==="rejected"?"#EF4444":"#F59E0B";
   const lbl = r.status==="approved"?"✅ معتمد":r.status==="rejected"?"❌ مرفوض":"⏳ قيد الاعتماد";
   return (
   <div key={r.id} style={{background:"#fff",border:`1px solid ${col}30`,borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
   <div style={{flex:1}}>
   <div style={{fontWeight:700,fontSize:12,color:"#1E293B"}}>{r.name}</div>
   <div style={{fontSize:10,color:"#5B7A9E"}}>{r.username} • {ROLES_LIST[r.role]}{r.job?` • ${r.job}`:""}</div>
   {r.status==="rejected"&&r.rejectNote&&<div style={{fontSize:10,color:"#EF4444",marginTop:2}}>سبب الرفض: {r.rejectNote}</div>}
   </div>
   <span style={{fontSize:11,fontWeight:800,color:col,background:`${col}15`,padding:"4px 12px",borderRadius:20}}>{lbl}</span>
   </div>
   );
   })}
   </div>
  </div>
  )}
   </main>

   {selfTarget&&<EvalForm partyKey="self" targetUser={user} existingScores={readPartyScore(myEval,"self",user.id)} onSave={saveSelfEval} onCancel={()=>setSelfTarget(null)} locks={locks} onLock={async(key)=>{const nl={...(locks||{}),[key]:{lockedAt:new Date().toISOString()}};setLocks(nl);await st.set('locks_360c',nl);}}/>}
   {peerTarget&&<EvalForm partyKey="peer" targetUser={peerTarget} lockKeyOverride={`${peerTarget.id}__peer__${user.id}`} existingScores={(isR2Active(peerTarget.id)?((evals[peerTarget.id]||{}).__r2?.peerRaters?.[user.id]):((evals[peerTarget.id]||{}).peerRaters?.[user.id]))||{}} onSave={scores=>savePeerEval(peerTarget.id,scores)} onCancel={()=>setPeerTarget(null)} locks={locks} onLock={async(key)=>{const nl={...(locks||{}),[key]:{lockedAt:new Date().toISOString()}};setLocks(nl);await st.set('locks_360c',nl);}}/>}
   {roleEvalTarget&&<RoleEvalForm party={roleEvalTarget.party} targetUser={roleEvalTarget.user} existingScores={((evals[roleEvalTarget.user.id]||{})[roleEvalTarget.party+"Raters"]?.[user.id])||{}} onSave={async scores=>{await saveRoleEval(roleEvalTarget.user.id,roleEvalTarget.party,scores);setRoleEvalTarget(null);}} onCancel={()=>setRoleEvalTarget(null)}/>}
   {viewCard&&<Card360 targetUser={user} empEval={evals[user.id]||{}} idpData={idps[user.id]} onSaveIdp={saveIdp} readings={readings} onSaveReadings={async d=>{setReadings(d);await st.set("readings_360c",d);}} currentUser={user} hidePrint allEvals={evals} allUsers={users} approvals={approvals} onClose={()=>setViewCard(false)}/>}
   {teamCardTarget&&<Card360 targetUser={teamCardTarget} empEval={evals[teamCardTarget.id]||{}} idpData={idps[teamCardTarget.id]} readings={readings} onSaveReadings={async d=>{setReadings(d);await st.set("readings_360c",d);}} currentUser={user} allEvals={evals} allUsers={users} approvals={approvals} onClose={()=>setTeamCardTarget(null)}/>}
  </div>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  componentDidCatch(e) { this.setState({ error: e?.message || String(e) }); }
  static getDerivedStateFromError(e) { return { error: e?.message || String(e) }; }
  render() {
  if (this.state.error) return (
   <div style={{padding:24,direction:"rtl",background:"#F1F6FB",minHeight:"100vh",color:"#15385C"}}>
  <div style={{color:"#EF4444",fontWeight:900,fontSize:16,marginBottom:12}}>خطأ في التطبيق:</div>
  <pre style={{background:"#fff",border:"1px solid #DDE9F5",padding:16,borderRadius:8,fontSize:12,color:"#5B7A9E",overflow:"auto",whiteSpace:"pre-wrap"}}>{this.state.error}</pre>
   </div>
  );
  return this.props.children;
  }
}

function AppInner() {
  const [user,setUser] = useState(null);
  const logout = () => setUser(null);
  const [ready, setReady] = useState(false);
  useEffect(()=>{ initSharedData().then(()=>setReady(true)).catch(e=>{ console.error(e); setReady(true); }); },[]);
  if (!ready) return <div style={{minHeight:"100vh",background:APP_BG,display:"flex",alignItems:"center",justifyContent:"center",color:"#5B7A9E",direction:"rtl",fontSize:13}}>جاري التحميل...</div>;
  if (!user) return <LoginScreen onLogin={setUser}/>;
  if (user.role==="admin") return <AdminPanel onLogout={logout}/>;
  if (user.role==="supervisor") return <EvaluatorPanel user={user} partyKey="supervisor" onLogout={logout}/>;
  if (user.role==="branch_mgr") return <BranchManagerPanel user={user} onLogout={logout}/>;
  if (user.role==="stage_mgr") return <StageManagerPanel user={user} onLogout={logout}/>;
  if (user.role==="exec") return <ExecPanel user={user} onLogout={logout}/>;
  return <EmployeePanel user={user} onLogout={logout}/>;
}

export default function App() {
  return <ErrorBoundary><GlobalStyles/><AppInner/></ErrorBoundary>;
}