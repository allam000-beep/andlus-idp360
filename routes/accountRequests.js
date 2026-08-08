// ج-1: مسارات طلبات فتح الحسابات
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/accountRequestsController');
const { requireAuth, requireRole } = require('../middleware/auth');

// الأدوار التي يحقّ لها تقديم طلب (مديرو الفروع/الإدارات) + مدير النظام
const CAN_REQUEST = ['admin', 'branch_mgr', 'dept_mgr', 'exec'];

router.get('/', requireAuth, ctrl.list);
router.post('/', requireAuth, requireRole(...CAN_REQUEST), ctrl.create);
router.post('/:id/approve', requireAuth, requireRole('admin'), ctrl.approve);
router.post('/:id/reject', requireAuth, requireRole('admin'), ctrl.reject);

module.exports = router;
