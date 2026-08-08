// ═══════════════════════════════════════════════════════════════
// استعادة قاعدة بيانات محلية إلى خادم مُشغَّل عبر واجهة التطبيق (API).
// يُستخدم حين يتعذّر رفع ملف القاعدة مباشرة إلى القرص الدائم.
//
//   node scripts/restore_to_server.js <source.db> <baseUrl> <adminUser> <adminPass> [--apply]
//
// بلا --apply يعرض ما سيفعله فقط (تشغيل جاف).
// كلمات المرور لا تُنقل (المخزَّن مُجزّأ لا يُستعاد)، فتُضبط كلمة مرور مبدئية
// موحّدة — نفس سلوك migration/import.js — ويجب تغييرها بعد الدخول.
// ═══════════════════════════════════════════════════════════════
const Database = require('better-sqlite3');

const [srcPath, BASE, ADMIN_USER, ADMIN_PASS] = process.argv.slice(2);
const APPLY = process.argv.includes('--apply');
const INIT_PASSWORD = process.env.MIGRATION_DEFAULT_PASSWORD || 'Andlus@2026';

if (!srcPath || !BASE || !ADMIN_USER || !ADMIN_PASS) {
  console.error('الاستخدام: node scripts/restore_to_server.js <source.db> <baseUrl> <adminUser> <adminPass> [--apply]');
  process.exit(1);
}

const db = new Database(srcPath, { readonly: true });
let H = null;
const log = (s) => console.log(s);
let done = 0, skipped = 0, failed = 0;

async function call(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
}

async function step(label, fn) {
  if (!APPLY) { log(`   [جاف] ${label}`); return; }
  const r = await fn();
  if (r.status >= 200 && r.status < 300) { done++; log(`   ✓ ${label}`); }
  else if (r.status === 409) { skipped++; log(`   ⊘ ${label} — موجود مسبقاً`); }
  else { failed++; log(`   ✗ ${label} — HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`); }
}

(async () => {
  const lr = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  if (!lr.ok) { console.error('فشل الدخول:', lr.status, await lr.text()); process.exit(1); }
  H = { authorization: 'Bearer ' + (await lr.json()).token, 'content-type': 'application/json' };
  log(`\n${APPLY ? '▶ تنفيذ فعلي' : '▶ تشغيل جاف (بلا كتابة)'} — ${BASE}\n`);

  // ─── 1) الإعدادات المشتركة (الجدارات، المسميات، المصادر، الأوزان…) ───
  log('1) الإعدادات المشتركة');
  for (const r of db.prepare('SELECT skey, value FROM settings').all()) {
    let value; try { value = JSON.parse(r.value); } catch { value = r.value; }
    const size = Array.isArray(value) ? `${value.length} عنصر` : `${Object.keys(value || {}).length} مفتاح`;
    await step(`${r.skey} (${size})`, () => call('POST', '/api/settings', { key: r.skey, value }));
  }

  // ─── 2) المستخدمون (بالترتيب: المديرون قبل من يرتبط بهم) ───
  log('\n2) المستخدمون');
  const branchesOf = db.prepare('SELECT branch FROM user_branches WHERE user_id=?');
  const stagesOf = db.prepare('SELECT stage FROM user_stages WHERE user_id=?');
  const ORDER = { admin: 0, exec: 1, branch_mgr: 2, stage_mgr: 3, deputy: 4, supervisor: 5, dept_mgr: 6, specialist: 7, branch_ext: 8, employee: 9 };
  const users = db.prepare('SELECT * FROM users').all()
    .sort((a, b) => (ORDER[a.role] ?? 99) - (ORDER[b.role] ?? 99));

  for (const u of users) {
    if (u.username === 'admin') { log(`   ⊘ admin — حساب المدير قائم على الخادم، لا يُلمس`); skipped++; continue; }
    const payload = {
      id: u.id, username: u.username, password: INIT_PASSWORD, name: u.name,
      nationalId: u.national_id, role: u.role, roleSubtype: u.role_subtype, job: u.job,
      branch: u.branch, stage: u.stage, supervisorType: u.supervisor_type,
      supervisorId: u.supervisor_id, stageManagerId: u.stage_manager_id,
      branches: branchesOf.all(u.id).map(r => r.branch),
      stages: stagesOf.all(u.id).map(r => r.stage),
    };
    await step(`${u.username} — ${u.name} (${u.role})`, () => call('POST', '/api/users', payload));
  }

  // ─── 3) زملاء التقييم ───
  const peers = db.prepare('SELECT employee_id, peer_id FROM peer_assignments').all();
  if (peers.length) {
    log('\n3) زملاء التقييم');
    const byEmp = {};
    peers.forEach(p => (byEmp[p.employee_id] = byEmp[p.employee_id] || []).push(p.peer_id));
    for (const [emp, ids] of Object.entries(byEmp)) {
      await step(`${emp}: ${ids.length} زميل`, () => call('PUT', `/api/users/${emp}/peers`, { peerIds: ids }));
    }
  } else log('\n3) زملاء التقييم — لا شيء');

  // ─── 4) درجات التقييم ───
  log('\n4) درجات التقييم');
  const scores = db.prepare('SELECT * FROM eval_scores').all();
  const wits = db.prepare('SELECT * FROM eval_witnesses').all();
  const groups = {};
  for (const s of scores) {
    const k = `${s.employee_id}|${s.party}|${s.round || 1}`;
    (groups[k] = groups[k] || { employee_id: s.employee_id, party: s.party, round: s.round || 1, scores: {} });
    (groups[k].scores[s.comp_key] = groups[k].scores[s.comp_key] || {})[s.item_index] = s.score;
  }
  for (const g of Object.values(groups)) {
    const witnesses = {};
    wits.filter(w => w.employee_id === g.employee_id && w.party === g.party)
        .forEach(w => { witnesses[w.comp_key] = w.witness_text; });
    const n = Object.values(g.scores).reduce((a, o) => a + Object.keys(o).length, 0);
    await step(`${g.employee_id} / ${g.party} / جولة ${g.round} — ${n} درجة`,
      () => call('POST', `/api/evals/${g.employee_id}`, { party: g.party, round: g.round, scores: g.scores, witnesses }));
  }

  // ─── 5) خطط التطور المهني ───
  log('\n5) خطط التطور المهني');
  const rowsOf = db.prepare('SELECT * FROM idp_rows WHERE employee_id=? ORDER BY sort_order');
  const idpHeads = db.prepare('SELECT * FROM idps').all();
  const empsWithRows = [...new Set(db.prepare('SELECT DISTINCT employee_id FROM idp_rows').all().map(r => r.employee_id))];
  const allEmps = [...new Set([...idpHeads.map(h => h.employee_id), ...empsWithRows])];
  for (const emp of allEmps) {
    const h = idpHeads.find(x => x.employee_id === emp) || {};
    const plan = rowsOf.all(emp).map(r => ({
      id: r.id, cat: r.cat, comp: r.comp, needSource: r.need_source, trainMethod: r.train_method,
      programName: r.program_name, provider: r.provider, url: r.url, cost: r.cost, hours: r.hours,
      targetDate: r.target_date, evalMethod: r.eval_method, status: r.status,
    }));
    let certificate; if (h.certificate) { try { certificate = JSON.parse(h.certificate); } catch { certificate = undefined; } }
    await step(`${emp} — ${plan.length} بند${h.approved ? ' (معتمدة)' : ''}${certificate ? ' + شهادة' : ''}`,
      () => call('PUT', `/api/idps/${emp}`, {
        plan, approved: !!h.approved, approvedBy: h.approved_by, approvedAt: h.approved_at,
        needsBranchApproval: !!h.needs_branch_approval, branchApprovedAt: h.branch_approved_at,
        editUnlocked: !!h.edit_unlocked, editUnlockedRow: h.edit_unlocked_row, certificate,
      }));
  }

  // ─── 6) نوافذ التقييم ───
  log('\n6) نوافذ التقييم');
  for (const w of db.prepare('SELECT * FROM eval_windows').all()) {
    await step(`${w.branch} — ${w.is_open ? 'مفتوحة' : 'مغلقة'}`,
      () => call('POST', '/api/windows', { branch: w.branch, isOpen: !!w.is_open, openDate: w.open_date, closeDate: w.close_date }));
  }

  // ─── 7) جداول مفاتيحها نصّية ───
  log('\n7) الاعتمادات والقراءات والدورات والترشيحات');
  for (const a of db.prepare('SELECT * FROM approvals').all())
    await step(`اعتماد ${a.approval_key}`, () => call('POST', '/api/approvals', { key: a.approval_key, approved: !!a.approved }));
  for (const r of db.prepare('SELECT * FROM readings').all())
    await step(`قراءة ${r.reading_key}`, () => call('POST', '/api/readings', { key: r.reading_key }));
  for (const c of db.prepare('SELECT * FROM internal_courses').all())
    await step(`دورة ${c.course_name}`, () => call('POST', '/api/courses', { courseName: c.course_name, employeeId: c.employee_id, actualDate: c.actual_date, attendance: c.attendance }));
  const twice = db.prepare('SELECT employee_id FROM twice_eval').all().map(r => r.employee_id);
  if (twice.length) await step(`ترشيحات التقييم الثاني (${twice.length})`, () => call('POST', '/api/twice', { list: twice }));

  // ─── 8) قياس الأثر ───
  const impact = db.prepare('SELECT * FROM impact_scores').all();
  if (impact.length) {
    log('\n8) قياس الأثر');
    const iw = db.prepare('SELECT * FROM impact_witnesses').all();
    const g = {};
    impact.forEach(s => { const k = `${s.employee_id}|${s.row_id}`; (g[k] = g[k] || { e: s.employee_id, r: s.row_id, scores: {} }).scores[s.item_index] = s.score; });
    for (const x of Object.values(g)) {
      const witnesses = iw.filter(w => w.employee_id === x.e && w.row_id === x.r).map(w => ({ type: w.wtype, value: w.value }));
      await step(`${x.e} / ${x.r}`, () => call('PUT', `/api/impact/${x.e}/${x.r}`, { scores: x.scores, witnesses }));
    }
  }

  log(`\n${'─'.repeat(50)}`);
  if (APPLY) log(`   نجح: ${done}   تُخطّي: ${skipped}   فشل: ${failed}`);
  else log('   تشغيل جاف — أعِد التنفيذ مع --apply للكتابة الفعلية');
  log(`   كلمة المرور المبدئية لكل حساب مُستعاد: ${INIT_PASSWORD}`);
  log(`${'─'.repeat(50)}\n`);
  process.exit(failed ? 1 : 0);
})();
