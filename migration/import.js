// ═══════════════════════════════════════════════════════════════
// استيراد بيانات النظام القديم (من andlus_export.json) إلى SQLite
// الاستخدام: node migration/import.js <path-to-andlus_export.json>
// ═══════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { db, initSchema, seedDefaults } = require('../db');

const file = process.argv[2];
if (!file) { console.error('الاستخدام: node migration/import.js <andlus_export.json>'); process.exit(1); }

const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const K = data.keys || {};
const S = data.shared || {};
const stats = {};
const bump = (k) => stats[k] = (stats[k] || 0) + 1;

initSchema();
seedDefaults();

const DEFAULT_PASSWORD = process.env.MIGRATION_DEFAULT_PASSWORD || 'Andlus@2026';
const defaultHash = bcrypt.hashSync(DEFAULT_PASSWORD, 12);

const run = db.transaction(() => {
  // ─── 1) المستخدمون ───
  const users = K.users_360c || [];
  const insUser = db.prepare(`INSERT OR REPLACE INTO users
    (id,username,password_hash,name,national_id,role,job,branch,stage,supervisor_type,supervisor_id,stage_manager_id)
    VALUES (@id,@username,@password_hash,@name,@national_id,@role,@job,@branch,@stage,@supervisor_type,@supervisor_id,@stage_manager_id)`);
  const insBranch = db.prepare('INSERT OR IGNORE INTO user_branches (user_id,branch) VALUES (?,?)');
  const insStage = db.prepare('INSERT OR IGNORE INTO user_stages (user_id,stage) VALUES (?,?)');
  const insPeer = db.prepare('INSERT OR IGNORE INTO peer_assignments (employee_id,peer_id) VALUES (?,?)');

  for (const u of users) {
    // كلمات المرور القديمة كانت نصاً صريحاً (ثغرة) — نُجزّئها الآن، أو نضع افتراضية
    let hash = defaultHash;
    if (u.password && typeof u.password === 'string' && u.password.length < 72) {
      hash = bcrypt.hashSync(u.password, 12);
    }
    insUser.run({
      id: u.id, username: u.username, password_hash: hash, name: u.name || u.username,
      national_id: u.nationalId || null, role: u.role || 'employee', job: u.job || null,
      branch: u.branch || null, stage: u.stage || null,
      supervisor_type: u.supervisorType || null,
      supervisor_id: u.supervisorId || null, stage_manager_id: u.stageManagerId || null,
    });
    bump('users');
  }
  // العلاقات بعد إدراج كل المستخدمين (لتفادي خطأ المفتاح الأجنبي)
  for (const u of users) {
    (u.branches || []).forEach(b => b && insBranch.run(u.id, b));
    (u.stages || []).forEach(s => s && insStage.run(u.id, s));
    const peers = u.peerIds || (u.peerId ? [u.peerId] : []);
    peers.forEach(pid => pid && insPeer.run(u.id, pid));
  }

  // ─── 2) التقييمات ───
  const evals = K.evals_360c || {};
  const insScore = db.prepare('INSERT OR REPLACE INTO eval_scores (employee_id,party,rater_id,comp_key,item_index,score) VALUES (?,?,?,?,?,?)');
  const insWit = db.prepare('INSERT OR REPLACE INTO eval_witnesses (employee_id,party,comp_key,witness_text) VALUES (?,?,?,?)');
  for (const [empId, ev] of Object.entries(evals)) {
    for (const party of ['self', 'peer', 'supervisor', 'stage_mgr']) {
      const pd = ev[party]; if (!pd) continue;
      for (const [comp, items] of Object.entries(pd)) {
        if (comp === '__witnesses') continue;
        for (const [idx, score] of Object.entries(items || {})) {
          if (Number(score) > 0) { insScore.run(empId, party, null, comp, Number(idx), Number(score)); bump('eval_scores'); }
        }
      }
    }
    // تقييمات الزملاء الفردية (peerRaters)
    if (ev.peerRaters) {
      for (const [raterId, comps] of Object.entries(ev.peerRaters)) {
        for (const [comp, items] of Object.entries(comps || {})) {
          for (const [idx, score] of Object.entries(items || {})) {
            if (Number(score) > 0) { insScore.run(empId, 'peer', raterId, comp, Number(idx), Number(score)); bump('peer_ratings'); }
          }
        }
      }
    }
  }

  // ─── 3) الأقفال ───
  const locks = K.locks_360c || {};
  const insLock = db.prepare("INSERT OR REPLACE INTO eval_locks (lock_key,locked_at) VALUES (?,?)");
  for (const [key, v] of Object.entries(locks)) { insLock.run(key, v?.lockedAt || new Date().toISOString()); bump('locks'); }

  // ─── 4) الخطط ───
  const idps = K.idps_360c || {};
  const insIdp = db.prepare(`INSERT OR REPLACE INTO idps
    (employee_id,approved,approved_by,approved_at,needs_branch_approval,branch_approved_at,edit_unlocked,edit_unlocked_row)
    VALUES (?,?,?,?,?,?,?,?)`);
  const insRow = db.prepare(`INSERT OR REPLACE INTO idp_rows
    (id,employee_id,cat,comp,need_source,train_method,program_name,provider,url,cost,hours,target_date,eval_method,status,sort_order)
    VALUES (@id,@employee_id,@cat,@comp,@need_source,@train_method,@program_name,@provider,@url,@cost,@hours,@target_date,@eval_method,@status,@sort_order)`);
  for (const [empId, idp] of Object.entries(idps)) {
    insIdp.run(empId, idp.approved ? 1 : 0, idp.approvedBy || null, idp.approvedAt || null,
      idp.needsBranchApproval ? 1 : 0, idp.branchApprovedAt || null,
      idp.editUnlocked ? 1 : 0, idp.editUnlockedRow || null);
    bump('idps');
    (idp.plan || []).forEach((r, i) => {
      insRow.run({
        id: r.id || `${empId}_${i}`, employee_id: empId,
        cat: r.cat || null, comp: r.comp || null, need_source: r.needSource || null,
        train_method: r.trainMethod || null, program_name: r.programName || null,
        provider: r.provider || null, url: r.url || null, cost: r.cost || null,
        hours: r.hours || null, target_date: r.targetDate || null,
        eval_method: r.evalMethod || null, status: r.status || 'لم يتم التنفيذ', sort_order: i,
      });
      bump('idp_rows');
    });
  }

  // ─── 5) قياس الأثر ───
  const impact = K.impact_360c || {};
  const insImpScore = db.prepare('INSERT OR REPLACE INTO impact_scores (employee_id,row_id,item_index,score) VALUES (?,?,?,?)');
  const insImpWit = db.prepare('INSERT INTO impact_witnesses (employee_id,row_id,wtype,value) VALUES (?,?,?,?)');
  for (const [key, v] of Object.entries(impact)) {
    const [empId, rowId] = key.split('__');
    if (!empId || !rowId) continue;
    for (const [idx, score] of Object.entries(v.scores || {})) {
      if (score != null) { insImpScore.run(empId, rowId, Number(idx), Number(score)); bump('impact_scores'); }
    }
    (v.witnesses || []).forEach(w => { if (w?.value) { insImpWit.run(empId, rowId, w.type || 'رابط', w.value); bump('impact_witnesses'); } });
  }

  // ─── 6) الاعتمادات، النوافذ، الطلبات، المزدوج، الدورات، القراءات ───
  const approvals = K.approvals_360c || {};
  const insAppr = db.prepare("INSERT OR REPLACE INTO approvals (approval_key,approved,approved_at) VALUES (?,?,?)");
  for (const [k, v] of Object.entries(approvals)) { if (v?.approved) { insAppr.run(k, 1, v.approvedAt || null); bump('approvals'); } }

  const win = K.evalwindow_360c || {};
  const insWin = db.prepare('INSERT OR REPLACE INTO eval_windows (branch,is_open,open_date,close_date) VALUES (?,?,?,?)');
  for (const [br, w] of Object.entries(win.branches || {})) { insWin.run(br, w.isOpen ? 1 : 0, w.openDate || null, w.closeDate || null); bump('windows'); }

  const editreq = K.editreq_360c || {};
  const insER = db.prepare('INSERT OR REPLACE INTO edit_requests (employee_id,status,row_id,note) VALUES (?,?,?,?)');
  for (const [empId, r] of Object.entries(editreq)) { insER.run(empId, r.status || 'pending', r.rowId || null, r.note || null); bump('edit_requests'); }

  const twice = K.twiceeval_360c || [];
  const insTw = db.prepare('INSERT OR IGNORE INTO twice_eval (employee_id) VALUES (?)');
  twice.forEach(id => { insTw.run(id); bump('twice'); });

  const courses = K.intcourses_360c || {};
  const insC = db.prepare('INSERT OR REPLACE INTO internal_courses (course_name,employee_id,actual_date,attendance) VALUES (?,?,?,?)');
  for (const [key, v] of Object.entries(courses)) {
    const idx = key.lastIndexOf('__'); if (idx < 0) continue;
    const cn = key.slice(0, idx), eid = key.slice(idx + 2);
    insC.run(cn, eid, v.actualDate || null, v.attendance || null); bump('courses');
  }

  const readings = K.readings_360c || {};
  const insR = db.prepare("INSERT OR REPLACE INTO readings (reading_key,read_at) VALUES (?,?)");
  for (const [k, v] of Object.entries(readings)) { insR.run(k, typeof v === 'string' ? v : new Date().toISOString()); bump('readings'); }

  // ─── 7) الإعدادات المشتركة ───
  const setMap = {
    customComps_360c: 'comps', customJobs_360c: 'jobs', customSources_360c: 'sources',
    customSourceMap_360c: 'sourceMap', customWeights_360c: 'weights',
  };
  const insSet = db.prepare('INSERT OR REPLACE INTO settings (skey,value) VALUES (?,?)');
  for (const [oldK, newK] of Object.entries(setMap)) {
    if (S[oldK] != null) { insSet.run(newK, JSON.stringify(S[oldK])); bump('settings'); }
  }
});

run();

console.log('\n✅ اكتمل الاستيراد. الإحصاءات:');
Object.entries(stats).forEach(([k, n]) => console.log(`  ${k}: ${n}`));
console.log(`\n⚠️  ملاحظة أمنية: كلمات المرور القديمة (نص صريح) جُزّئت بـ bcrypt.`);
console.log(`   من تعذّر تحويل كلمته استُخدمت له كلمة افتراضية: "${DEFAULT_PASSWORD}"`);
console.log(`   يجب مطالبة المستخدمين بتغييرها عند أول دخول.`);
