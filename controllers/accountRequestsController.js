// ج-1: طلبات فتح الحسابات — مدير الفرع/الإدارة يطلب، مدير النظام يعتمد/يرفض
const crypto = require('crypto');
const { db } = require('../db');
const { hashPassword } = require('../config/auth');

// كلمة مرور مؤقتة عشوائية (يغيّرها المستخدم لاحقاً عبر «نسيت كلمة السر»)
function tempPassword() {
  return 'Andlus@' + crypto.randomBytes(4).toString('hex');
}

// GET /api/account-requests
// مدير النظام: كل الطلبات. مدير الفرع/الإدارة: طلباته هو فقط.
function list(req, res) {
  let rows;
  if (req.user.role === 'admin') {
    rows = db.prepare('SELECT * FROM account_requests ORDER BY created_at DESC').all();
  } else {
    rows = db.prepare('SELECT * FROM account_requests WHERE requester_id = ? ORDER BY created_at DESC').all(req.user.id);
  }
  res.json({ requests: rows.map(mapReq) });
}

function mapReq(r) {
  return {
    id: r.id, name: r.name, username: r.username, nationalId: r.national_id,
    // كلمة المرور المبدئية لا تُعاد إلا للطلبات المعلّقة (يحتاجها مقدّم الطلب لإبلاغ الموظف).
    // بعد الاعتماد/الرفض تُمحى من الجدول فلا تبقى مخزّنة كنصّ صريح.
    password: r.status === 'pending' ? r.init_password : undefined,
    role: r.role, roleSubtype: r.role_subtype, job: r.job, branch: r.branch, stage: r.stage,
    status: r.status, requesterId: r.requester_id, requesterName: r.requester_name,
    rejectNote: r.reject_note, createdAt: r.created_at, decidedAt: r.decided_at,
  };
}

// POST /api/account-requests — تقديم طلب (مدير فرع/إدارة أو مدير نظام)
function create(req, res) {
  const b = req.body || {};
  if (!b.name || !b.username || !b.role) {
    return res.status(400).json({ error: 'الاسم والبريد (اسم المستخدم) والدور مطلوبة' });
  }
  // تحقّق النطاق: غير المدير لا يطلب خارج فروعه (قد يدير فرعين: بنين/بنات)
  if (req.user.role !== 'admin') {
    // نجمع كل فروع مقدّم الطلب: من الجدول متعدّد الفروع + الفرع المفرد
    const multi = db.prepare('SELECT branch FROM user_branches WHERE user_id = ?').all(req.user.id).map(r => r.branch);
    const single = db.prepare('SELECT branch FROM users WHERE id = ?').get(req.user.id)?.branch;
    const myBranches = [...new Set([...multi, ...(single ? [single] : [])])];
    if (b.branch && myBranches.length && !myBranches.includes(b.branch)) {
      return res.status(403).json({ error: 'لا يمكنك طلب حساب خارج نطاقك' });
    }
    // نفرض أول فرع إن لم يُرسَل
    if (!b.branch) b.branch = myBranches[0] || null;
  }
  const dup = db.prepare("SELECT 1 FROM users WHERE username = ?").get(b.username)
           || db.prepare("SELECT 1 FROM account_requests WHERE username = ? AND status='pending'").get(b.username);
  if (dup) return res.status(409).json({ error: 'البريد (اسم المستخدم) مستخدم أو له طلب معلّق' });

  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO account_requests
    (id,name,username,national_id,init_password,role,role_subtype,job,branch,stage,status,requester_id,requester_name)
    VALUES (@id,@name,@username,@national_id,@init_password,@role,@role_subtype,@job,@branch,@stage,'pending',@requester_id,@requester_name)`)
    .run({
      id, name: b.name, username: b.username, national_id: b.nationalId || null,
      init_password: b.password || tempPassword(),
      role: b.role, role_subtype: b.roleSubtype || null, job: b.job || null,
      branch: b.branch || null, stage: b.stage || null,
      requester_id: req.user.id, requester_name: req.user.name || null,
    });
  res.status(201).json({ request: mapReq(db.prepare('SELECT * FROM account_requests WHERE id=?').get(id)) });
}

// POST /api/account-requests/:id/approve — مدير النظام: يُنشئ الحساب فعلياً
async function approve(req, res) {
  const r = db.prepare('SELECT * FROM account_requests WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'الطلب غير موجود' });
  if (r.status !== 'pending') return res.status(409).json({ error: 'الطلب محسوم مسبقاً' });

  const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(r.username);
  if (exists) return res.status(409).json({ error: 'اسم المستخدم أصبح مستخدماً' });

  const uid = crypto.randomUUID();
  const hash = await hashPassword(r.init_password || tempPassword());
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO users
      (id,username,password_hash,name,national_id,role,role_subtype,job,branch,stage)
      VALUES (@id,@username,@password_hash,@name,@national_id,@role,@role_subtype,@job,@branch,@stage)`)
      .run({
        id: uid, username: r.username, password_hash: hash, name: r.name,
        national_id: r.national_id, role: r.role, role_subtype: r.role_subtype,
        job: r.job, branch: r.branch, stage: r.stage,
      });
    // تُمحى كلمة المرور المبدئية بعد إنشاء الحساب (صارت مجزّأة في users)
    db.prepare("UPDATE account_requests SET status='approved', init_password=NULL, decided_at=datetime('now') WHERE id=?").run(r.id);
  });
  tx();
  res.json({ ok: true, userId: uid });
}

// POST /api/account-requests/:id/reject — مدير النظام
function reject(req, res) {
  const r = db.prepare('SELECT * FROM account_requests WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'الطلب غير موجود' });
  if (r.status !== 'pending') return res.status(409).json({ error: 'الطلب محسوم مسبقاً' });
  db.prepare("UPDATE account_requests SET status='rejected', reject_note=?, init_password=NULL, decided_at=datetime('now') WHERE id=?")
    .run((req.body && req.body.note) || null, r.id);
  res.json({ ok: true });
}

module.exports = { list, create, approve, reject };
