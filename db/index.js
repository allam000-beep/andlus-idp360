// ═══════════════════════════════════════════════════════════════
// وحدة الاتصال بقاعدة بيانات SQLite
// تستخدم better-sqlite3 (متزامن، سريع، مثالي لـ SQLite)
// ═══════════════════════════════════════════════════════════════
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// مسار ملف قاعدة البيانات (قابل للتهيئة عبر متغيّر بيئة)
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'andlus.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

// تهيئة المخطّط عند أول تشغيل (idempotent — آمن للتكرار)
function initSchema() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  console.log('✓ تمّت تهيئة مخطّط قاعدة البيانات');
}

// ─── ترحيل قاعدة البيانات (ترقية القواعد القديمة من نسخة سابقة) ───
// يعمل بأمان على القواعد القديمة والجديدة معاً (idempotent).
function migrate() {
  // 1) إضافة عمود role_subtype لجدول users إن لم يوجد
  const userCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!userCols.includes('role_subtype')) {
    db.exec('ALTER TABLE users ADD COLUMN role_subtype TEXT');
    console.log('✓ أُضيف عمود role_subtype إلى users');
  }

  // 2) إعادة بناء users إذا كانت CHECK القديمة لا تقبل الأدوار الجديدة
  const userSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get()?.sql || '';
  if (!userSql.includes('branch_ext')) {
    rebuildUsers();
    console.log('✓ أُعيد بناء جدول users بالقيود الجديدة');
  }

  // 3) إعادة بناء eval_scores إذا كانت party CHECK لا تقبل الأطراف الجديدة
  const evalSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='eval_scores'").get()?.sql || '';
  if (!evalSql.includes('subordinate')) {
    rebuildEvalScores();
    console.log('✓ أُعيد بناء جدول eval_scores بالقيود الجديدة');
  } else {
    // الجدول يقبل الأطراف الجديدة لكن قد ينقصه عمود round (ب-4) → نعيد بناءه لإضافته
    const scoreCols = db.prepare('PRAGMA table_info(eval_scores)').all().map(c => c.name);
    if (!scoreCols.includes('round')) {
      rebuildEvalScores();
      console.log('✓ أُضيف عمود round إلى eval_scores');
    }
  }
  // 4) عمود certificate في جدول idps (للشهادة الاحترافية ضمن الخطة)
  const idpCols = db.prepare('PRAGMA table_info(idps)').all().map(c => c.name);
  if (!idpCols.includes('certificate')) {
    db.exec('ALTER TABLE idps ADD COLUMN certificate TEXT');
    console.log('✓ أُضيف عمود certificate إلى idps');
  }
  if (!idpCols.includes('is_final')) {
    db.exec('ALTER TABLE idps ADD COLUMN is_final INTEGER DEFAULT 0');
    console.log('✓ أُضيف عمود is_final إلى idps');
  }
  // 5) عمود init_password في account_requests (كلمة المرور المبدئية)
  const arSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='account_requests'").get()?.sql;
  if (arSql) {
    const arCols = db.prepare('PRAGMA table_info(account_requests)').all().map(c => c.name);
    if (!arCols.includes('init_password')) {
      db.exec('ALTER TABLE account_requests ADD COLUMN init_password TEXT');
      console.log('✓ أُضيف عمود init_password إلى account_requests');
    }
  }
}

function rebuildUsers() {
  const tx = db.transaction(() => {
    db.pragma('foreign_keys = OFF');
    try {
      db.exec(`
        CREATE TABLE users_new (
          id              TEXT PRIMARY KEY,
          username        TEXT UNIQUE NOT NULL,
          password_hash   TEXT NOT NULL,
          name            TEXT NOT NULL,
          national_id     TEXT,
          role            TEXT NOT NULL CHECK(role IN ('admin','exec','branch_mgr','stage_mgr','deputy','supervisor','dept_mgr','specialist','branch_ext','employee')),
          role_subtype    TEXT,
          job             TEXT,
          branch          TEXT,
          stage           TEXT,
          supervisor_type TEXT,
          supervisor_id   TEXT,
          stage_manager_id TEXT,
          created_at      TEXT DEFAULT (datetime('now')),
          updated_at      TEXT DEFAULT (datetime('now'))
        );
        INSERT INTO users_new (id, username, password_hash, name, national_id, role, role_subtype, job, branch, stage, supervisor_type, supervisor_id, stage_manager_id, created_at, updated_at)
          SELECT id, username, password_hash, name, national_id, role, role_subtype, job, branch, stage, supervisor_type, supervisor_id, stage_manager_id, created_at, updated_at FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
        CREATE INDEX IF NOT EXISTS idx_users_role   ON users(role);
        CREATE INDEX IF NOT EXISTS idx_users_branch ON users(branch);
        CREATE INDEX IF NOT EXISTS idx_users_stage  ON users(stage);
        CREATE INDEX IF NOT EXISTS idx_users_super  ON users(supervisor_id);
        CREATE INDEX IF NOT EXISTS idx_users_stmgr  ON users(stage_manager_id);
      `);
    } finally {
      db.pragma('foreign_keys = ON');
    }
  });
  tx();
}

function rebuildEvalScores() {
  const tx = db.transaction(() => {
    db.pragma('foreign_keys = OFF');
    try {
      // نكتشف إن كان العمود round موجوداً في الجدول القديم لننقله أو نضع 1 افتراضياً
      const oldCols = db.prepare('PRAGMA table_info(eval_scores)').all().map(c => c.name);
      const hadRound = oldCols.includes('round');
      db.exec(`
        CREATE TABLE eval_scores_new (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          employee_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          party        TEXT NOT NULL CHECK(party IN ('self','peer','supervisor','stage_mgr','subordinate','beneficiary')),
          rater_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
          round        INTEGER NOT NULL DEFAULT 1,
          comp_key     TEXT NOT NULL,
          item_index   INTEGER NOT NULL,
          score        REAL NOT NULL CHECK(score >= 0 AND score <= 5),
          updated_at   TEXT DEFAULT (datetime('now')),
          UNIQUE(employee_id, party, rater_id, round, comp_key, item_index)
        );
        INSERT INTO eval_scores_new (id, employee_id, party, rater_id, round, comp_key, item_index, score, updated_at)
          SELECT id, employee_id, party, rater_id, ${hadRound ? 'round' : '1'}, comp_key, item_index, score, updated_at FROM eval_scores;
        DROP TABLE eval_scores;
        ALTER TABLE eval_scores_new RENAME TO eval_scores;
        CREATE INDEX IF NOT EXISTS idx_eval_emp   ON eval_scores(employee_id);
        CREATE INDEX IF NOT EXISTS idx_eval_party ON eval_scores(employee_id, party);
      `);
    } finally {
      db.pragma('foreign_keys = ON');
    }
  });
  tx();
}

// نبذر الإعدادات الافتراضية إن كانت القاعدة فارغة
function seedDefaults() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM settings').get().n;
  if (count === 0) {
    const defaults = {
      weights: { self:{"أساسية":5}, peer:{"أساسية":5}, supervisor:{"عامة":22.5,"فنية":22.5}, stage_mgr:{"أساسية":45} },
      comps: {}, jobs: {}, sources: {}, sourceMap: {}, compRoleItems: {}
    };
    const ins = db.prepare('INSERT INTO settings (skey, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(defaults)) ins.run(k, JSON.stringify(v));
    console.log('✓ بُذرت الإعدادات الافتراضية');
  }
}

module.exports = { db, initSchema, migrate, seedDefaults, DB_PATH };
