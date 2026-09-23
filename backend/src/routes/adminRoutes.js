const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, requireRole } = require('../middleware/auth');
const { listPendingRenters, approveRenter, rejectRenter } = require('../modules/admin/adminService');
const { validateBody } = require('./validation');

const router = Router();

// Every route here is Admin-only.
router.use(authenticate, requireRole('admin'));

router.get(
  '/renters/pending',
  asyncHandler(async (req, res) => {
    const renters = await listPendingRenters();
    res.json(renters);
  })
);

router.post(
  '/renters/:userId/approve',
  asyncHandler(async (req, res) => {
    const result = await approveRenter({
      renterUserId: Number(req.params.userId),
      adminUserId: req.user.id,
    });
    res.json(result);
  })
);

router.post(
  '/renters/:userId/reject',
  validateBody(z.object({ reason: z.string().max(500).optional() })),
  asyncHandler(async (req, res) => {
    const result = await rejectRenter({
      renterUserId: Number(req.params.userId),
      adminUserId: req.user.id,
      reason: req.body.reason,
    });
    res.json(result);
  })
);

module.exports = router;
