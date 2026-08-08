// ═══════════════════════════════════════════════════════════════
// طبقة API الوسيطة لنظام الأندلس
// تحاكي واجهة st القديمة (get/set/getShared/setShared) لكن تنادي
// خادم Express بدل window.storage — فتتحوّل الواجهة بأقل تعديل.
// ═══════════════════════════════════════════════════════════════
(function () {
  const BASE = window.ANDLUS_API_BASE || '/api';
  let TOKEN = localStorage.getItem('andlus_token') || null;

  // ─── أداة النداء ───
  async function call(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
    const res = await fetch(BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      const hadToken = !!TOKEN;
      TOKEN = null; localStorage.removeItem('andlus_token');
      if (hadToken && !path.includes('/auth/login')) window.location.reload();
      throw new Error('انتهت الجلسة');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'خطأ في الخادم');
    return data;
  }

  // ─── المصادقة ───
  const auth = {
    async login(username, password) {
      const d = await call('POST', '/auth/login', { username, password });
      TOKEN = d.token; localStorage.setItem('andlus_token', d.token);
      invalidateSettings();   // جلسة جديدة — لا نُبقي إعدادات جلسة سابقة في الذاكرة
      return d.user;
    },
    logout() { TOKEN = null; localStorage.removeItem('andlus_token'); invalidateSettings(); },
    isLoggedIn() { return !!TOKEN; },
    async me() { return (await call('GET', '/auth/me')).user; },
    async changePassword(currentPassword, newPassword) {
      return await call('POST', '/auth/change-password', { currentPassword, newPassword });
    },
    async forgotPassword(username) {
      return await call('POST', '/auth/forgot-password', { username });
    },
    async resetPassword(token, newPassword) {
      return await call('POST', '/auth/reset-password', { token, newPassword });
    },
  };

  // هيكل تقييم فارغ — احتياط إن غاب موظف عن ردّ الجلب الجماعي
  const _emptyEval = () => ({ self:{}, peer:{}, supervisor:{}, stage_mgr:{}, subordinate:{}, beneficiary:{} });

  // ─── تحويل مفاتيح st إلى نداءات API ───
  // القراءة: تُعيد نفس بنية البيانات التي كانت في window.storage
  async function get(key) {
    switch (key) {
      case 'users_360c': {
        const { users } = await call('GET', '/users');
        // نحوّل snake_case → camelCase لتوافق الواجهة
        return users.map(mapUserToClient);
      }
      case 'evals_360c': {
        // طلبان اثنان مهما بلغ عدد الموظفين. كان سابقاً طلباً لكل موظف، فمدرسة
        // بمئتي موظف كانت تستهلك ٢٠١ طلباً في كل تحميل وتصطدم بحدّ المعدّل.
        const [{ users }, { evals }] = await Promise.all([
          call('GET', '/users'),
          call('GET', '/evals'),
        ]);
        const out = {};
        for (const u of users) {
          // نجلب تقييمات كل من يُقيَّم (الموظف والقياديون والتخصصيون) — لا الموظف وحده
          if (u.role === 'admin') continue;
          const d = (evals && evals[u.id]) || { eval: _emptyEval(), peerCount: 0 };
          out[u.id] = { ...d.eval };
          if (d.peerRaters) out[u.id].peerRaters = d.peerRaters;
          if (d.subordinateRaters) out[u.id].subordinateRaters = d.subordinateRaters;
          if (d.beneficiaryRaters) out[u.id].beneficiaryRaters = d.beneficiaryRaters;
          out[u.id].__peerCount = d.peerCount;
        }
        _snap.evals = _clone(out);
        return out;
      }
      case 'idps_360c': {
        const { idps } = await call('GET', '/idps');
        const out = {};
        for (const [id, v] of Object.entries(idps)) {
          out[id] = {
            approved: !!v.approved, approvedBy: v.approved_by, approvedAt: v.approved_at,
            needsBranchApproval: !!v.needs_branch_approval, branchApprovedAt: v.branch_approved_at,
            editUnlocked: !!v.edit_unlocked, editUnlockedRow: v.edit_unlocked_row,
            plan: v.plan || [],
            certificate: v.certificate ? (typeof v.certificate === 'string' ? JSON.parse(v.certificate) : v.certificate) : undefined,
          };
        }
        _snap.idps = _clone(out);
        return out;
      }
      case 'impact_360c': { const d=(await call('GET', '/impact')).impact; _snap.impact=_clone(d); return d; }
      case 'approvals_360c': { const d=(await call('GET', '/approvals')).approvals; _snap.approvals=_clone(d); return d; }
      case 'evalwindow_360c': return await call('GET', '/windows');
      case 'editreq_360c': return (await call('GET', '/edit-requests')).editRequests;
      case 'twiceeval_360c': return (await call('GET', '/twice')).twice;
      case 'round2_360c': return await call('GET', '/round2').catch(()=>null);
      case 'intcourses_360c': return (await call('GET', '/courses')).courses;
      case 'locks_360c': return (await call('GET', '/evals/locks')).locks;
      case 'readings_360c': { const d=(await call('GET', '/readings')).readings; _snap.readings=_clone(d); return d; }
      case 'acctRequests_360c': return await direct.listAccountRequests();
      default: return null;
    }
  }

  // الكتابة: تُترجم إلى نداء API المناسب.
  // ملاحظة: الواجهة القديمة تكتب الكائن كاملاً؛ نحن نرسل ما يلزم فقط.
  // لتقليل التعديل، نوفّر دوالّ مباشرة أدق (setX) تُستدعى من الواجهة المعدّلة.
  // لقطات لآخر حالة قُرئت من الخادم (للمقارنة عند الكتابة)
  const _snap = { evals:{}, idps:{}, impact:{}, approvals:{}, readings:{} };
  const _clone = (o) => JSON.parse(JSON.stringify(o||{}));

  async function set(key, value) {
    switch (key) {
      case 'evalwindow_360c':
        for (const [br, w] of Object.entries(value.branches || {}))
          await call('POST', '/windows', { branch: br, ...w });
        return;
      case 'twiceeval_360c':
        return void await call('POST', '/twice', { list: value });
      case 'round2_360c':
        return void await call('POST', '/round2', value).catch(()=>{});
      case 'acctRequests_360c': {
        const server = await direct.listAccountRequests();
        const byId = {}; server.forEach(r => { byId[r.id] = r; });
        for (const r of (value || [])) {
          const prev = byId[r.id];
          if (!prev) { if (r.status === 'pending') await direct.createAccountRequest(r); }
          else if (prev.status === 'pending' && r.status !== prev.status) {
            if (r.status === 'approved') await direct.approveAccountRequest(r.id);
            else if (r.status === 'rejected') await direct.rejectAccountRequest(r.id, r.rejectNote || '');
          }
        }
        return;
      }
      case 'evals_360c':
        return void await saveEvalsDiff(value);
      case 'idps_360c':
        return void await saveIdpsDiff(value);
      case 'impact_360c':
        return void await saveImpactDiff(value);
      case 'approvals_360c':
        return void await saveApprovalsDiff(value);
      case 'readings_360c':
        return void await saveReadingsDiff(value);
      case 'locks_360c':
        return; // الأقفال تُدار عبر lockEval المباشرة عند الحفظ النهائي
      default:
        console.warn('[api] set(' + key + ') غير مربوط');
        return;
    }
  }

  // مقارنة كائن الدرجات لطرف معيّن (هل تغيّر؟)
  const _jsonEq = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {});

  // حفظ التقييمات: نرسل فقط (موظف/طرف/جولة) الذي تغيّر
  async function saveEvalsDiff(nv) {
    nv = nv || {};
    for (const empId of Object.keys(nv)) {
      const cur = nv[empId] || {};
      const old = _snap.evals[empId] || {};
      // الجولة الأولى: الأطراف المباشرة (self/supervisor/stage_mgr) + المجهولة عبر بصمة المُقيّم
      const parties = ['self', 'supervisor', 'stage_mgr'];
      for (const p of parties) {
        if (!_jsonEq(cur[p], old[p]) && cur[p] && Object.keys(cur[p]).length)
          await direct.saveEval(empId, p, cur[p], 1);
      }
      // الأطراف المجهولة (peer/subordinate/beneficiary): تُحفظ ببصمة المُقيّم الحالي فقط
      for (const p of ['peer', 'subordinate', 'beneficiary']) {
        const rk = p + 'Raters';
        const curMine = (cur[rk] || {})[_meId()];
        const oldMine = (old[rk] || {})[_meId()];
        if (curMine && !_jsonEq(curMine, oldMine) && Object.keys(curMine).length)
          await direct.saveEval(empId, p, curMine, 1);
      }
      // الجولة الثانية (__r2)
      if (cur.__r2) {
        const o2 = old.__r2 || {};
        for (const p of parties) {
          if (!_jsonEq(cur.__r2[p], o2[p]) && cur.__r2[p] && Object.keys(cur.__r2[p]).length)
            await direct.saveEval(empId, p, cur.__r2[p], 2);
        }
        for (const p of ['peer', 'subordinate', 'beneficiary']) {
          const rk = p + 'Raters';
          const curMine = ((cur.__r2[rk]) || {})[_meId()];
          const oldMine = ((o2[rk]) || {})[_meId()];
          if (curMine && !_jsonEq(curMine, oldMine) && Object.keys(curMine).length)
            await direct.saveEval(empId, p, curMine, 2);
        }
      }
    }
    _snap.evals = _clone(nv);
  }

  async function saveIdpsDiff(nv) {
    nv = nv || {};
    for (const empId of Object.keys(nv)) {
      if (!_jsonEq(nv[empId], _snap.idps[empId]))
        await direct.saveIdp(empId, nv[empId]);
    }
    _snap.idps = _clone(nv);
  }

  async function saveImpactDiff(nv) {
    nv = nv || {};
    for (const k of Object.keys(nv)) {
      if (!_jsonEq(nv[k], _snap.impact[k])) {
        const [empId, rowId] = k.split('__');
        if (empId && rowId) await direct.saveImpact(empId, rowId, nv[k]);
      }
    }
    _snap.impact = _clone(nv);
  }

  async function saveApprovalsDiff(nv) {
    nv = nv || {};
    for (const k of Object.keys(nv)) {
      if (!_jsonEq(nv[k], _snap.approvals[k]))
        await direct.setApproval(k, !!(nv[k] && nv[k].approved));
    }
    _snap.approvals = _clone(nv);
  }

  async function saveReadingsDiff(nv) {
    nv = nv || {};
    for (const k of Object.keys(nv)) {
      if (nv[k] && !_snap.readings[k]) await direct.setReading(k);
    }
    _snap.readings = _clone(nv);
  }

  // معرّف المستخدم الحالي (من الرمز) — للأطراف المجهولة
  function _meId() {
    try { return JSON.parse(atob(TOKEN.split('.')[1])).id; } catch { return null; }
  }

  // ─── الإعدادات المشتركة ───
  // خريطة واحدة للمفاتيح (كانت مكرّرة في القراءة والكتابة، فأيّ تعديل على إحداهما
  // كان يمكن أن يُنسى في الأخرى).
  const SHARED_KEYS = {
    customComps_360c: 'comps', customJobs_360c: 'jobs',
    customSources_360c: 'sources', customSourceMap_360c: 'sourceMap',
    customWeights_360c: 'weights', compRoleItems_360c: 'compRoleItems',
    profCerts_360c: 'profCerts',
  };

  // مسار /settings يُعيد كتلة الإعدادات كاملة (~9KB) لا مفتاحاً واحداً، وكانت
  // الواجهة تناديه مرّة لكل مفتاح — سبعة طلبات متطابقة في كل تحميل. نجمعها هنا:
  //   • النداءات المتزامنة تتشارك الوعد نفسه (طلب واحد لا سبعة).
  //   • القراءات المتقاربة تُخدَم من الذاكرة لمدة قصيرة.
  //   • أيّ كتابة تُبطل الذاكرة فوراً حتى لا يُقرأ ما قبل الحفظ.
  const SETTINGS_TTL_MS = 3000;
  let _settingsCache = null;      // { at, data }
  let _settingsInFlight = null;

  function invalidateSettings() { _settingsCache = null; _settingsInFlight = null; }

  function loadSettings() {
    if (_settingsCache && Date.now() - _settingsCache.at < SETTINGS_TTL_MS) {
      return Promise.resolve(_settingsCache.data);
    }
    if (_settingsInFlight) return _settingsInFlight;
    const p = call('GET', '/settings').then(
      (d) => {
        const data = (d && d.settings) || {};
        _settingsCache = { at: Date.now(), data };
        if (_settingsInFlight === p) _settingsInFlight = null;
        return data;
      },
      (err) => {                     // عند الفشل لا نخزّن شيئاً كي تُعاد المحاولة
        if (_settingsInFlight === p) _settingsInFlight = null;
        throw err;
      }
    );
    _settingsInFlight = p;
    return p;
  }

  async function getShared(key) {
    const skey = SHARED_KEYS[key]; if (!skey) return null;
    const settings = await loadSettings();
    return settings[skey] ?? null;
  }
  async function setShared(key, value) {
    const skey = SHARED_KEYS[key]; if (!skey) return;
    await call('POST', '/settings', { key: skey, value });
    invalidateSettings();   // الحفظ يُبطل الذاكرة فتُقرأ القيمة الجديدة لا القديمة
  }

  // ─── دوال API مباشرة (للعمليات الدقيقة) ───
  const direct = {
    // المستخدمون
    createUser: (u) => call('POST', '/users', u),
    updateUser: (id, u) => call('PUT', '/users/' + id, u),
    deleteUser: (id) => call('DELETE', '/users/' + id),
    setPeers: (id, peerIds) => call('PUT', '/users/' + id + '/peers', { peerIds }),
    // التقييمات
    saveEval: (empId, party, scores, round, witnesses) =>
      call('POST', '/evals/' + empId, { party, scores, round: round || 1, witnesses: witnesses || {} }),
    lockEval: (empId, party) => call('POST', '/evals/' + empId + '/lock', { party }),
    getEval: (empId) => call('GET', '/evals/' + empId),
    // الخطط
    saveIdp: (empId, idp) => call('PUT', '/idps/' + empId, idp),
    // قياس الأثر
    saveImpact: (empId, rowId, data) => call('PUT', '/impact/' + empId + '/' + rowId, data),
    // الاعتمادات وطلبات التعديل والدورات والقراءات
    setApproval: (key, approved) => call('POST', '/approvals', { key, approved }),
    setEditRequest: (b) => call('POST', '/edit-requests', b),
    setCourse: (b) => call('POST', '/courses', b),
    setReading: (key) => call('POST', '/readings', { key }),
    // ج-1: طلبات فتح الحسابات
    listAccountRequests: async () => (await call('GET', '/account-requests')).requests,
    createAccountRequest: (b) => call('POST', '/account-requests', b),
    approveAccountRequest: (id) => call('POST', '/account-requests/' + id + '/approve'),
    rejectAccountRequest: (id, note) => call('POST', '/account-requests/' + id + '/reject', { note }),
  };

  function mapUserToClient(u) {
    return {
      id: u.id, username: u.username, name: u.name, nationalId: u.national_id,
      role: u.role, roleSubtype: u.roleSubtype || u.role_subtype || null, job: u.job, branch: u.branch, stage: u.stage,
      supervisorType: u.supervisor_type, supervisorId: u.supervisor_id,
      stageManagerId: u.stage_manager_id,
      branches: u.branches || [], stages: u.stages || [], peerIds: u.peerIds || [],
    };
  }

  // نكشف الواجهة عالمياً
  window.andlusAPI = { auth, get, set, getShared, setShared, ...direct, mapUserToClient };
})();
