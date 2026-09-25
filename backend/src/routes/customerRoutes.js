const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, requireRole } = require('../middleware/auth');
const { registerCustomer } = require('../modules/customers/customerService');
const { getExecutiveSubscriptionPreview } = require('../modules/checkout/checkoutService');
const viewingService = require('../modules/viewings/viewingService');
const { customerRegisterSchema, validateBody } = require('./validation');

const router = Router();

router.post(
  '/register',
  validateBody(customerRegisterSchema),
  asyncHandler(async (req, res) => {
    const result = await registerCustomer(req.body);
    res.status(201).json(result);
  })
);

// Public - lets the app show the Executive tier's real monthly price (base fee + Admin
// Costs + VAT) before signup, at whatever rates Admin currently has configured.
router.get(
  '/executive-subscription-cost',
  asyncHandler(async (req, res) => {
    res.json(await getExecutiveSubscriptionPreview());
  })
);

// --- Executive Feature Viewing bookings - Customer's own, across all listings ---

router.get(
  '/me/viewings',
  authenticate,
  requireRole('customer'),
  asyncHandler(async (req, res) => {
    res.json(await viewingService.listMyViewings(req.user.id));
  })
);

router.post(
  '/me/viewings/:id/cancel',
  authenticate,
  requireRole('customer'),
  asyncHandler(async (req, res) => {
    res.json(await viewingService.cancelViewing(Number(req.params.id), req.user.id));
  })
);

module.exports = router;
