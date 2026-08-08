// مسارات المنطق الأساسي: التقييمات، الخطط، قياس الأثر، البيانات المساعدة
const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');

const evals = require('../controllers/evalsController');
const idps = require('../controllers/idpsController');
const impact = require('../controllers/impactController');
const data = require('../controllers/dataController');

// كل المسارات تتطلّب مصادقة
router.use(requireAuth);

// ─── التقييمات ───
// ملاحظة ترتيب: المسارات الثابتة قبل :employeeId وإلا التقطها كمعرّف موظف
router.get('/evals/locks', evals.getLocks);
router.get('/evals', evals.listAllEvals);          // الجميع في طلب واحد
router.get('/evals/:employeeId', evals.getEmployeeEval);
router.post('/evals/:employeeId', evals.saveEval);
router.post('/evals/:employeeId/lock', evals.lockEval);

// ─── الخطط ───
router.get('/idps', idps.listIdps);
router.get('/idps/:employeeId', idps.getIdp);
router.put('/idps/:employeeId', idps.saveIdp);

// ─── قياس الأثر (الحفظ للمتابع الفني ومدير النظام) ───
router.get('/impact', impact.listImpact);
router.put('/impact/:employeeId/:rowId', requireRole('supervisor', 'admin'), impact.saveImpact);

// ─── الاعتمادات ───
router.get('/approvals', data.getApprovals);
router.post('/approvals', requireRole('admin', 'branch_mgr'), data.setApproval);

// ─── نوافذ التقييم (المدير فقط) ───
router.get('/windows', data.getWindows);
router.post('/windows', requireRole('admin'), data.setWindow);

// ─── طلبات التعديل ───
router.get('/edit-requests', data.getEditRequests);
router.post('/edit-requests', data.setEditRequest);

// ─── التقييم المزدوج (المتابع/المدير) ───
router.get('/twice', data.getTwice);
router.post('/twice', requireRole('supervisor', 'admin'), data.setTwice);

// ─── ب-4: حالة التقييم الثاني (القراءة للجميع، الفتح/الإغلاق للمدير) ───
router.get('/round2', data.getRound2);
router.post('/round2', requireRole('admin'), data.setRound2);

// ─── الدورات الحضورية ───
router.get('/courses', data.getCourses);
router.post('/courses', requireRole('admin'), data.setCourse);

// ─── القراءات ───
router.get('/readings', data.getReadings);
router.post('/readings', data.setReading);

// ─── الإعدادات المشتركة (التعديل للمدير) ───
router.get('/settings', data.getSettings);
router.post('/settings', requireRole('admin'), data.setSetting);

module.exports = router;
