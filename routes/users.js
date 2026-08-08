// مسارات المستخدمين (الحسابات)
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/usersController');
const { requireAuth, requireRole } = require('../middleware/auth');

// القراءة متاحة لكل مُصادَق عليه (كل حساب يحتاج قائمة المستخدمين للربط)
router.get('/', requireAuth, ctrl.list);
router.get('/:id', requireAuth, ctrl.getOne);

// الإنشاء/التعديل/الحذف للمدير فقط
router.post('/', requireAuth, requireRole('admin'), ctrl.create);
router.put('/:id', requireAuth, requireRole('admin'), ctrl.update);
router.delete('/:id', requireAuth, requireRole('admin'), ctrl.remove);

// تعيين زملاء التقييم — لكل مستخدم مُصادَق عليه (مدراء/متابعون/موظفون)
router.put('/:id/peers', requireAuth, ctrl.assignPeers);

module.exports = router;
