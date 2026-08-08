// يقارن قاعدة محلية بخادم مُستعاد للتأكّد من تطابق المحتوى.
//   node scripts/verify_restore.js <source.db> <baseUrl> <adminUser> <adminPass>
const Database = require('better-sqlite3');
const [srcPath, BASE, U, P] = process.argv.slice(2);
const db = new Database(srcPath, { readonly: true });
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + '   ' + x)); };
const S = (v) => { // stable stringify
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(S).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + S(v[k])).join(',') + '}';
};

(async () => {
  const lr = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: U, password: P }) });
  const H = { authorization: 'Bearer ' + (await lr.json()).token, 'content-type': 'application/json' };
  const get = async (p) => (await (await fetch(BASE + p, { headers: H })).json());

  console.log('\n─── الإعدادات ───');
  const srv = (await get('/api/settings')).settings;
  for (const r of db.prepare('SELECT skey, value FROM settings').all()) {
    ok(`settings.${r.skey}`, S(srv[r.skey]) === S(JSON.parse(r.value)), 'مختلف');
  }

  console.log('\n─── المستخدمون ───');
  const su = (await get('/api/users')).users;
  const byId = Object.fromEntries(su.map(u => [u.id, u]));
  for (const u of db.prepare('SELECT * FROM users').all()) {
    if (u.username === 'admin') continue;
    const t = byId[u.id];
    if (!t) { ok(`${u.username} موجود`, false, 'مفقود على الخادم'); continue; }
    const same = t.username === u.username && t.name === u.name && t.role === u.role &&
      (t.job || null) === (u.job || null) && (t.branch || null) === (u.branch || null) &&
      (t.stage || null) === (u.stage || null) && (t.roleSubtype || null) === (u.role_subtype || null) &&
      (t.national_id || null) === (u.national_id || null) &&
      (t.supervisor_id || null) === (u.supervisor_id || null) &&
      (t.stage_manager_id || null) === (u.stage_manager_id || null) &&
      (t.supervisor_type || null) === (u.supervisor_type || null);
    ok(`${u.username} (${u.role}) — كل الحقول`, same,
       JSON.stringify({ srv: { j: t.job, b: t.branch, s: t.stage, rs: t.roleSubtype, nid: t.national_id, sup: t.supervisor_id, sm: t.stage_manager_id }, src: { j: u.job, b: u.branch, s: u.stage, rs: u.role_subtype, nid: u.national_id, sup: u.supervisor_id, sm: u.stage_manager_id } }));
    const brs = db.prepare('SELECT branch FROM user_branches WHERE user_id=?').all(u.id).map(r => r.branch).sort();
    const sts = db.prepare('SELECT stage FROM user_stages WHERE user_id=?').all(u.id).map(r => r.stage).sort();
    if (brs.length) ok(`${u.username} — الفروع المتعددة (${brs.length})`, S([...(t.branches || [])].sort()) === S(brs), S(t.branches));
    if (sts.length) ok(`${u.username} — المراحل المتعددة (${sts.length})`, S([...(t.stages || [])].sort()) === S(sts), S(t.stages));
  }

  console.log('\n─── درجات التقييم ───');
  const bulk = (await get('/api/evals')).evals;
  const groups = {};
  for (const s of db.prepare('SELECT * FROM eval_scores').all()) {
    const k = `${s.employee_id}|${s.party}|${s.round || 1}`;
    (groups[k] = groups[k] || {});
    (groups[k][s.comp_key] = groups[k][s.comp_key] || {})[s.item_index] = s.score;
  }
  for (const [k, expect] of Object.entries(groups)) {
    const [emp, party, round] = k.split('|');
    const e = bulk[emp];
    const actual = round === '2' ? (e && e.eval.__r2 && e.eval.__r2[party]) : (e && e.eval[party]);
    ok(`${party} / جولة ${round} / ${emp.slice(0, 12)}`, S(actual) === S(expect), `متوقّع ${S(expect).slice(0, 70)} — وجد ${S(actual).slice(0, 70)}`);
  }

  console.log('\n─── الخطط ───');
  const idps = (await get('/api/idps')).idps;
  for (const h of db.prepare('SELECT * FROM idps').all()) {
    const t = idps[h.employee_id];
    if (!t) { ok(`خطة ${h.employee_id.slice(0, 12)}`, false, 'مفقودة'); continue; }
    const srcRows = db.prepare('SELECT * FROM idp_rows WHERE employee_id=? ORDER BY sort_order').all(h.employee_id);
    ok(`خطة ${h.employee_id.slice(0, 12)} — ${srcRows.length} بند`, (t.plan || []).length === srcRows.length, `وجد ${(t.plan || []).length}`);
    ok(`خطة ${h.employee_id.slice(0, 12)} — حالة الاعتماد`, !!t.approved === !!h.approved, `${t.approved} != ${h.approved}`);
    if (srcRows.length) {
      const a = (t.plan || [])[0] || {}, b = srcRows[0];
      ok(`خطة ${h.employee_id.slice(0, 12)} — تفاصيل أول بند`,
         a.programName === b.program_name && a.comp === b.comp && String(a.hours ?? '') === String(b.hours ?? '') && a.status === b.status,
         JSON.stringify({ srv: { p: a.programName, c: a.comp, h: a.hours, s: a.status }, src: { p: b.program_name, c: b.comp, h: b.hours, s: b.status } }));
    }
    if (h.certificate) {
      // الخادم يُعيد الشهادة نصّاً JSON والواجهة تفكّه (public/api.js) — نحاكي ذلك هنا
      const got = typeof t.certificate === 'string' ? JSON.parse(t.certificate) : t.certificate;
      ok(`خطة ${h.employee_id.slice(0, 12)} — الشهادة الاحترافية`, S(got) === S(JSON.parse(h.certificate)), S(got).slice(0, 90));
    }
  }

  console.log('\n─── نوافذ التقييم ───');
  const w = (await get('/api/windows')).branches;
  for (const r of db.prepare('SELECT * FROM eval_windows').all()) {
    ok(`نافذة ${r.branch}`, w[r.branch] && !!w[r.branch].isOpen === !!r.is_open, S(w[r.branch]));
  }

  console.log(`\n   PASS: ${pass}    FAIL: ${fail}\n`);
  process.exit(fail ? 1 : 0);
})();
