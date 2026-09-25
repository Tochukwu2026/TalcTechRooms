const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, requireRole } = require('../middleware/auth');
const {
  listPendingRenters,
  approveRenter,
  rejectRenter,
  listPriceCaps,
  updatePriceCap,
  createPriceCap,
  listSettings,
  updateSetting,
} = require('../modules/admin/adminService');
const payoutService = require('../modules/payout/payoutService');
const viewingService = require('../modules/viewings/viewingService');
const {
  validateBody,
  updatePriceCapSchema,
  createPriceCapSchema,
  updateSettingSchema,
  resolveReviewCaseSchema,
  assignStaffSchema,
} = require('./validation');

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

// --- Price Cap management ---

router.get(
  '/price-caps',
  asyncHandler(async (req, res) => {
    res.json(await listPriceCaps());
  })
);

router.post(
  '/price-caps',
  validateBody(createPriceCapSchema),
  asyncHandler(async (req, res) => {
    const result = await createPriceCap(req.body);
    res.status(201).json(result);
  })
);

router.patch(
  '/price-caps/:id',
  validateBody(updatePriceCapSchema),
  asyncHandler(async (req, res) => {
    const result = await updatePriceCap(Number(req.params.id), req.body.capNaira);
    res.json(result);
  })
);

// --- Admin-editable business settings (commission %, VAT %, admin fee, SMS cost, etc.) ---

router.get(
  '/settings',
  asyncHandler(async (req, res) => {
    res.json(await listSettings());
  })
);

router.patch(
  '/settings/:key',
  validateBody(updateSettingSchema),
  asyncHandler(async (req, res) => {
    const result = await updateSetting(req.params.key, req.body.value);
    res.json(result);
  })
);

// --- Renter payout review queue (Path A only - Path B never enters this queue) ---
// See spec/decisions-and-phasing.md > Renter Payout: flagged/reported check-in-day bookings
// land here for manual resolution.

router.get(
  '/review-cases',
  asyncHandler(async (req, res) => {
    const status = req.query.status === 'resolved' ? 'resolved' : 'open';
    res.json(await payoutService.listReviewCases(status));
  })
);

router.patch(
  '/review-cases/:id/resolve',
  validateBody(resolveReviewCaseSchema),
  asyncHandler(async (req, res) => {
    const result = await payoutService.resolveReviewCase(Number(req.params.id), req.user.id, req.body);
    res.json(result);
  })
);

// --- Live/Video Viewing staff assignment queue ---
// See spec/decisions-and-phasing.md > Platform & Stack > Admin Portal / Staff access.

router.get(
  '/viewings',
  asyncHandler(async (req, res) => {
    const { status, unassignedOnly } = req.query;
    res.json(await viewingService.listViewingsForAdmin({ status, unassignedOnly: unassignedOnly === 'true' }));
  })
);

router.patch(
  '/viewings/:id/assign',
  validateBody(assignStaffSchema),
  asyncHandler(async (req, res) => {
    res.json(await viewingService.assignStaff(Number(req.params.id), req.body.staffUserId));
  })
);

module.exports = router;
