const { Router } = require('express');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, requireRole } = require('../middleware/auth');
const { registerCustomer } = require('../modules/customers/customerService');
const { getExecutiveSubscriptionPreview } = require('../modules/checkout/checkoutService');
const viewingService = require('../modules/viewings/viewingService');
const accountService = require('../modules/customers/accountService');
const executiveUpgradeService = require('../modules/customers/executiveUpgradeService');
const {
  customerRegisterSchema,
  updateCustomerProfileSchema,
  changePasswordSchema,
  autoRenewSchema,
  validateBody,
} = require('./validation');

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

// --- The Customer's own account: view/edit details, change password ---

router.get(
  '/me',
  authenticate,
  requireRole('customer'),
  asyncHandler(async (req, res) => {
    res.json(await accountService.getProfile(req.user.id));
  })
);

router.patch(
  '/me',
  authenticate,
  requireRole('customer'),
  validateBody(updateCustomerProfileSchema),
  asyncHandler(async (req, res) => {
    res.json(await accountService.updateProfile(req.user.id, req.body));
  })
);

router.post(
  '/me/password',
  authenticate,
  requireRole('customer'),
  validateBody(changePasswordSchema),
  asyncHandler(async (req, res) => {
    res.json(await accountService.changePassword(req.user.id, req.body));
  })
);

// Turn monthly Executive auto-renewal on/off. Off = keep Executive until the paid month ends, then
// become Regular (see modules/customers/renewalService.js).
router.patch(
  '/me/subscription',
  authenticate,
  requireRole('customer'),
  validateBody(autoRenewSchema),
  asyncHandler(async (req, res) => {
    res.json(await accountService.setAutoRenew(req.user.id, req.body.autoRenew));
  })
);

// --- Upgrade Regular -> Executive, paid through Paystack ---

router.post(
  '/me/executive-upgrade/initialize',
  authenticate,
  requireRole('customer'),
  asyncHandler(async (req, res) => {
    res.status(201).json(await executiveUpgradeService.initializeUpgrade(req.user.id, req.user.email));
  })
);

// The app's own fallback for confirming the payment (the Paystack webhook is the primary
// trigger) - safe to call more than once, see executiveUpgradeService.finalizeUpgrade.
router.post(
  '/me/executive-upgrade/verify/:reference',
  authenticate,
  requireRole('customer'),
  asyncHandler(async (req, res) => {
    const result = await executiveUpgradeService.finalizeUpgrade(req.params.reference);

    if (result.status === 'not_found') {
      throw new ApiError(404, 'No charge was found for this reference.');
    }
    if (result.status === 'payment_failed') {
      return res.status(402).json({ status: 'payment_failed' });
    }
    // Only let the Customer who paid see their own subscription.
    if (String(result.subscription.customerUserId) !== String(req.user.id)) {
      throw new ApiError(403, 'You do not have permission to view this subscription.');
    }
    res.status(result.status === 'upgraded' ? 201 : 200).json({
      status: result.status,
      tier: 'executive',
      subscription: result.subscription,
    });
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
