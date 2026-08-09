-- ═══════════════════════════════════════════════════════════════
-- نظام الأندلس للتقييم 360° وخطط التطور المهني
-- مخطّط قاعدة بيانات SQLite
-- ═══════════════════════════════════════════════════════════════

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;   -- أداء أفضل للقراءة/الكتابة المتزامنة

-- ─────────────────────────────────────────────────────────────
-- 1) المستخدمون (الحسابات)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,          -- معرّف فريد (uuid)
  username        TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,             -- bcrypt hash (لا نص صريح إطلاقاً)
  name            TEXT NOT NULL,
  national_id     TEXT,
  role            TEXT NOT NULL CHECK(role IN ('admin','exec','branch_mgr','stage_mgr','deputy','supervisor','dept_mgr','specialist','branch_ext','employee')),
  role_subtype    TEXT,                       -- النوع الفرعي (edu/students/hr/finance...)
  job             TEXT,                       -- المسمّى الوظيفي
  branch          TEXT,                       -- الفرع الأساسي
  stage           TEXT,                       -- المرحلة الأساسية
  supervisor_type TEXT,                       -- للمتابع الفني: مشرف مختص | وكيل
  supervisor_id   TEXT REFERENCES users(id) ON DELETE SET NULL,   -- المتابع الفني
  stage_manager_id TEXT REFERENCES users(id) ON DELETE SET NULL,  -- المدير المباشر
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_role   ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_branch ON users(branch);
CREATE INDEX IF NOT EXISTS idx_users_stage  ON users(stage);
CREATE INDEX IF NOT EXISTS idx_users_super  ON users(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_users_stmgr  ON users(stage_manager_id);

-- الفروع/المراحل المتعددة (لمدير الفرع قد يدير عدة فروع، ومدير المرحلة عدة مراحل)
CREATE TABLE IF NOT EXISTS user_branches (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch   TEXT NOT NULL,
  PRIMARY KEY (user_id, branch)
);
CREATE TABLE IF NOT EXISTS user_stages (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stage    TEXT NOT NULL,
  PRIMARY KEY (user_id, stage)
);

-- زملاء التخصص المُقيّمون لكل موظف (علاقة متعدد-لمتعدد)
CREATE TABLE IF NOT EXISTS peer_assignments (
  employee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  peer_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (employee_id, peer_id)
);

-- ─────────────────────────────────────────────────────────────
-- 2) تقييم الأداء 360°
-- ─────────────────────────────────────────────────────────────
-- درجة كل بند من كل طرف. للزملاء: rater_id يميّز كل مُقيّم (إخفاء الهوية عند العرض)
CREATE TABLE IF NOT EXISTS eval_scores (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  party        TEXT NOT NULL CHECK(party IN ('self','peer','supervisor','stage_mgr','subordinate','beneficiary')),
  rater_id     TEXT REFERENCES users(id) ON DELETE SET NULL,  -- للزملاء: من قيّم. لغيرهم NULL
  round        INTEGER NOT NULL DEFAULT 1,   -- ب-4: 1=التقييم الأول، 2=التقييم الثاني
  comp_key     TEXT NOT NULL,               -- اسم الجدارة
  item_index   INTEGER NOT NULL,            -- رقم البند داخل الجدارة
  score        REAL NOT NULL CHECK(score >= 0 AND score <= 5),
  updated_at   TEXT DEFAULT (datetime('now')),
  UNIQUE(employee_id, party, rater_id, round, comp_key, item_index)
);
CREATE INDEX IF NOT EXISTS idx_eval_emp   ON eval_scores(employee_id);
CREATE INDEX IF NOT EXISTS idx_eval_party ON eval_scores(employee_id, party);

-- الشواهد المرفقة مع درجة 5 (للمتابع والمدير المباشر)
CREATE TABLE IF NOT EXISTS eval_witnesses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  party        TEXT NOT NULL,
  comp_key     TEXT NOT NULL,
  witness_text TEXT,
  UNIQUE(employee_id, party, comp_key)
);

-- أقفال الحفظ النهائي لكل طرف (تم = مقفول). للزملاء المفتاح يشمل rater
CREATE TABLE IF NOT EXISTS eval_locks (
  lock_key   TEXT PRIMARY KEY,   -- مثل: empId__party  أو  empId__peer__raterId
  locked_at  TEXT DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────────────────────────
-- 3) خطط التطور المهني (IDP)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS idps (
  employee_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  approved              INTEGER DEFAULT 0,   -- اعتماد المتابع الفني
  approved_by           TEXT,
  approved_at           TEXT,
  needs_branch_approval INTEGER DEFAULT 0,   -- خطة جديدة تحتاج اعتماد مفرد من مدير الفرع
  branch_approved_at    TEXT,
  edit_unlocked         INTEGER DEFAULT 0,
  edit_unlocked_row     TEXT,
  is_final              INTEGER DEFAULT 0,    -- أنهى الموظف التخطيط (حفظ وإغلاق)
  certificate           TEXT,                -- د-9: الشهادة الاحترافية (JSON)
  updated_at            TEXT DEFAULT (datetime('now'))
);

-- بنود الخطة (كل موظف عدة بنود)
CREATE TABLE IF NOT EXISTS idp_rows (
  id            TEXT PRIMARY KEY,            -- معرّف البند
  employee_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cat           TEXT,                        -- الفئة: أساسية | عامة | فنية
  comp          TEXT,                        -- الجدارة
  need_source   TEXT,
  train_method  TEXT,
  program_name  TEXT,
  provider      TEXT,
  url           TEXT,
  cost          TEXT,
  hours         TEXT,
  target_date   TEXT,
  eval_method   TEXT,                        -- أسلوب قياس الأثر
  status        TEXT DEFAULT 'لم يتم التنفيذ',
  sort_order    INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_idprows_emp ON idp_rows(employee_id);

-- ─────────────────────────────────────────────────────────────
-- 4) قياس أثر التدريب
-- ─────────────────────────────────────────────────────────────
-- درجة كل بند من بنود أسلوب قياس الأثر لكل بند تطويري
CREATE TABLE IF NOT EXISTS impact_scores (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  row_id      TEXT NOT NULL REFERENCES idp_rows(id) ON DELETE CASCADE,
  item_index  INTEGER NOT NULL,
  score       REAL CHECK(score >= 0 AND score <= 100),   -- نسبة مئوية
  UNIQUE(employee_id, row_id, item_index)
);
CREATE INDEX IF NOT EXISTS idx_impact_emp ON impact_scores(employee_id, row_id);

-- شواهد قياس الأثر (متعددة لكل بند تطويري)
CREATE TABLE IF NOT EXISTS impact_witnesses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  row_id      TEXT NOT NULL REFERENCES idp_rows(id) ON DELETE CASCADE,
  wtype       TEXT,                          -- رابط | صورة | ملف
  value       TEXT
);
CREATE INDEX IF NOT EXISTS idx_impactw_emp ON impact_witnesses(employee_id, row_id);

-- ─────────────────────────────────────────────────────────────
-- 5) الاعتمادات والأقفال الإدارية
-- ─────────────────────────────────────────────────────────────
-- اعتماد النتائج/الخطط لكل (فرع، مرحلة). kind: eval | plans
CREATE TABLE IF NOT EXISTS approvals (
  approval_key TEXT PRIMARY KEY,   -- مثل: branch__stage__eval
  approved     INTEGER DEFAULT 1,
  approved_at  TEXT DEFAULT (datetime('now'))
);

-- نوافذ فتح/إغلاق التقييم لكل فرع
CREATE TABLE IF NOT EXISTS eval_windows (
  branch      TEXT PRIMARY KEY,
  is_open      INTEGER DEFAULT 0,
  open_date    TEXT,
  close_date   TEXT
);

-- ج-3: رموز إعادة تعيين كلمة المرور (تصل عبر بريد الموظف = اسم المستخدم)
CREATE TABLE IF NOT EXISTS password_resets (
  token       TEXT PRIMARY KEY,           -- رمز عشوائي يُرسل في الرابط
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,              -- ينتهي بعد ساعة
  used        INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pwreset_user ON password_resets(user_id);

-- ج-1: طلبات فتح الحسابات (من مدير الفرع/الإدارة، يعتمدها مدير النظام)
CREATE TABLE IF NOT EXISTS account_requests (
  id            TEXT PRIMARY KEY,           -- uuid للطلب
  name          TEXT NOT NULL,              -- اسم الموظف المطلوب
  username      TEXT NOT NULL,              -- بريده الفعلي (اسم المستخدم)
  national_id   TEXT,
  init_password TEXT,                        -- كلمة المرور المبدئية التي حدّدها مقدّم الطلب
  role          TEXT NOT NULL,
  role_subtype  TEXT,
  job           TEXT,
  branch        TEXT,                       -- ضمن نطاق مقدّم الطلب
  stage         TEXT,
  status        TEXT DEFAULT 'pending',     -- pending | approved | rejected
  requester_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  requester_name TEXT,
  reject_note   TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  decided_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_acctreq_status ON account_requests(status);
CREATE INDEX IF NOT EXISTS idx_acctreq_branch ON account_requests(branch);

-- طلبات التعديل من المتابعين الفنيين لمدير الفرع
CREATE TABLE IF NOT EXISTS edit_requests (
  employee_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT DEFAULT 'pending',   -- pending | approved | rejected
  row_id      TEXT,
  note        TEXT,
  requested_at TEXT DEFAULT (datetime('now'))
);

-- الموظفون المحددون للتقييم مرتين في العام
CREATE TABLE IF NOT EXISTS twice_eval (
  employee_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
);

-- الدورات الحضورية الداخلية: تاريخ التنفيذ والحضور لكل موظف
CREATE TABLE IF NOT EXISTS internal_courses (
  course_name TEXT NOT NULL,
  employee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actual_date TEXT,
  attendance  TEXT,                     -- حضر | لم يحضر | معتذر
  PRIMARY KEY (course_name, employee_id)
);

-- قراءات النتائج (سجل من اطّلع)
CREATE TABLE IF NOT EXISTS readings (
  reading_key TEXT PRIMARY KEY,
  read_at     TEXT DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────────────────────────
-- 6) الإعدادات المشتركة (كانت custom*_360c المشتركة)
-- ─────────────────────────────────────────────────────────────
-- تُخزَّن كوثائق JSON لأنها إعدادات مرنة يعدّلها المدير، وحجمها صغير
CREATE TABLE IF NOT EXISTS settings (
  skey  TEXT PRIMARY KEY,   -- comps | jobs | sources | sourceMap | weights
  value TEXT NOT NULL       -- JSON
);

-- ─────────────────────────────────────────────────────────────
-- 7) سجل تدقيق أمني (من فعل ماذا ومتى) — لبيئة production
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT,
  action     TEXT,
  detail     TEXT,
  ip         TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
