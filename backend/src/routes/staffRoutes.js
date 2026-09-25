// Staff (who conduct Live/Video Viewings) get a limited-permission view - see their own
// assigned viewings, mark one complete once done. Not a mobile account type - see
// spec/decisions-and-phasing.md > Platform & Stack > Staff access. Every route here is
// Staff-only, mirroring adminRoutes.js's blanket role guard.

const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, requireRole } = require('../middleware/auth');
const viewingService = require('../modules/viewings/viewingService');

const router = Router();

router.use(authenticate, requireRole('staff'));

router.get(
  '/viewings/me',
  asyncHandler(async (req, res) => {
    res.json(await viewingService.listMyAssignedViewings(req.user.id));
  })
);

router.post(
  '/viewings/:id/complete',
  asyncHandler(async (req, res) => {
    res.json(await viewingService.markViewingComplete(Number(req.params.id), req.user.id));
  })
);

module.exports = router;
