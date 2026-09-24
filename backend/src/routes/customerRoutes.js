const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { registerCustomer } = require('../modules/customers/customerService');
const { getExecutiveSubscriptionPreview } = require('../modules/checkout/checkoutService');
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

module.exports = router;
