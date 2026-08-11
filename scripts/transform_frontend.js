// ═══════════════════════════════════════════════════════════════
// سكربت تحويل واجهة الـ artifact (JSX) إلى واجهة سيرفر
// يعدّل نقاط ربط التخزين ليستخدم andlusAPI بدل window.storage
//
// الاستخدام: node scripts/transform_frontend.js <input.jsx> <output.jsx>
// ═══════════════════════════════════════════════════════════════
const fs = require('fs');

const [,, inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('الاستخدام: node transform_frontend.js <input.jsx> <output.jsx>');
  process.exit(1);
}

let code = fs.readFileSync(inPath, 'utf8');
const report = [];

// 1) استبدال تعريف st ليستخدم andlusAPI (قبل أي معالجة لـ window.storage)
const stOld = /const st = \{\s*\n\s*get: async[\s\S]*?forgotPassword: async[^\n]*\n\};/;
const stNew = `const st = {
  get: async k => { try { return await window.andlusAPI.get(k); } catch(e){ console.error(e); return null; } },
  set: async (k,v) => { try { await window.andlusAPI.set(k,v); } catch(e){ console.error(e); } },
  getShared: async k => { try { return await window.andlusAPI.getShared(k); } catch(e){ console.error(e); return null; } },
  setShared: async (k,v) => { try { await window.andlusAPI.setShared(k,v); } catch(e){ console.error(e); } },
  forgotPassword: async (username) => { try { return await window.andlusAPI.forgotPassword(username); } catch(e){ console.error(e); return { ok:true }; } },
};`;
if (stOld.test(code)) { code = code.replace(stOld, stNew); report.push('✓ استُبدل تعريف st'); }
else report.push('✗ لم يُعثر على تعريف st — راجع يدوياً');

// 2) استبدال أي window.storage.get/set مباشر متبقٍّ
const directGets = (code.match(/window\.storage\.get\(/g) || []).length;
const directSets = (code.match(/window\.storage\.set\(/g) || []).length;
code = code.replace(/await window\.storage\.get\("([^"]+)"\)/g, 'await window.andlusAPI.get("$1")');
code = code.replace(/await window\.storage\.set\("([^"]+)",\s*JSON\.stringify\(([^)]+)\)\)/g, 'await window.andlusAPI.set("$1", $2)');
// safeGet داخلي: window.storage.get(k, shared) → andlusAPI حسب shared
code = code.replace(/const r = await window\.storage\.get\(k, shared\); return r\?\.value \? JSON\.parse\(r\.value\) : null;/,
  'return shared ? await window.andlusAPI.getShared(k) : await window.andlusAPI.get(k);');
report.push(`✓ استُبدلت نداءات window.storage المباشرة (get:${directGets}, set:${directSets})`);

// 3) إزالة سطر import React (سيُوفَّر عالمياً عبر <script>)
code = code.replace(/^import React[^\n]*\n/m, '');
report.push('✓ أُزيل سطر import React');

// 4) استبدال export default بتصدير عالمي
code = code.replace(/export default function App/, 'function App');
if (!/window\.__AndlusApp/.test(code)) {
  code += '\n\nwindow.__AndlusApp = App;\n';
}
report.push('✓ حُوّل export default إلى window.__AndlusApp');

// 5) ربط شاشة الدخول بالمصادقة الحقيقية (API) بدل المقارنة المحلية
const loginOld = /const login = async \(\) => \{\s*\n\s*if \(u === ADMIN_CREDS[\s\S]*?if \(found\) onLogin\(found\); else \{ setErr\(true\); setP\(""\); \}\s*\n\s*\};/;
// ملاحظة: هذا البديل يستبدل دالّة login كاملةً، فأيّ منطق يُضاف داخلها في المصدر
// (مثل فحص وضع الصيانة سابقاً) يُمحى صامتاً عند البناء. لذلك يُفرض وضع الصيانة في
// الخادم (authController.login يُعيد 503)، ويكتفي هذا البديل بعرض رسالته.
const loginNew = `const login = async () => {
  try {
    const user = await window.andlusAPI.auth.login(u, p);
    onLogin(user);
  } catch (e) {
    if (e && e.status === 503) { setErr(false); setP(""); setMaintMsg(e.message || "النظام قيد التحديث، يُرجى المحاولة لاحقاً"); return; }
    setMaintMsg(""); setErr(true); setP("");
  }
  };`;
if (loginOld.test(code)) { code = code.replace(loginOld, loginNew); report.push('✓ رُبطت شاشة الدخول بالـ API'); }
else report.push('⚠ لم يُطابق نمط login — راجع يدوياً');

// 6) ربط تغيير كلمة المرور بالـ API (مكوّن المدير — يستخدم sha256/adminpass)
const cpAdminOld = /const submit = async \(\) => \{\s*\n\s*setMsg\(null\);\s*\n\s*const oldHash = await sha256Hex\(oldP\);[\s\S]*?catch\(e\) \{ setMsg\(\{t:"خطأ في الحفظ، حاول مجدداً",c:"#EF4444"\}\); \}\s*\n\s*\};/;
const cpNew = `const submit = async () => {
  setMsg(null);
  if (newP.length < 6) { setMsg({t:"كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف",c:"#EF4444"}); return; }
  if (newP !== confirmP) { setMsg({t:"تأكيد كلمة المرور غير مطابق",c:"#EF4444"}); return; }
  if (newP === oldP) { setMsg({t:"كلمة المرور الجديدة مطابقة للحالية",c:"#F59E0B"}); return; }
  try {
    await window.andlusAPI.auth.changePassword(oldP, newP);
    setMsg({t:"✓ تم تغيير كلمة المرور بنجاح",c:"#10B981"});
    setOldP(""); setNewP(""); setConfirmP("");
    setTimeout(()=>{ setOpen(false); setMsg(null); }, 1400);
  } catch(e) { setMsg({t: e.message || "كلمة المرور الحالية غير صحيحة", c:"#EF4444"}); }
  };`;
if (cpAdminOld.test(code)) { code = code.replace(cpAdminOld, cpNew); report.push('✓ رُبط تغيير كلمة مرور المدير بالـ API'); }
else report.push('⚠ لم يُطابق نمط تغيير كلمة مرور المدير');

// 7) ربط تغيير كلمة المرور بالـ API (مكوّن المستخدمين — يستخدم currentPassword)
const cpUserOld = /const submit = async \(\) => \{\s*\n\s*setMsg\(null\);\s*\n\s*if \(oldP !== currentPassword\)[\s\S]*?catch\(e\) \{ setMsg\(\{t:"خطأ في الحفظ، حاول مجدداً",c:"#EF4444"\}\); \}\s*\n\s*\};/;
if (cpUserOld.test(code)) { code = code.replace(cpUserOld, cpNew); report.push('✓ رُبط تغيير كلمة مرور المستخدمين بالـ API'); }
else report.push('⚠ لم يُطابق نمط تغيير كلمة مرور المستخدمين');

fs.writeFileSync(outPath, code, 'utf8');
console.log('\n'.padEnd(2) + 'تقرير التحويل:');
report.forEach(r => console.log('  ' + r));
console.log(`\n✓ كُتب الناتج: ${outPath} (${Math.round(code.length/1024)}KB)`);
