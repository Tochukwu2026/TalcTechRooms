const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, requireRole } = require('../middleware/auth');
const { registerRenter, getRenterById, updateBankDetails } = require('../modules/renters/renterService');
const { renterRegisterSchema, bankDetailsSchema, validateBody } = require('./validation');

const router = Router();

router.post(
  '/register',
  validateBody(renterRegisterSchema),
  asyncHandler(async (req, res) => {
    const result = await registerRenter(req.body);
    res.status(201).json(result);
  })
);

router.get(
  '/me',
  authenticate,
  requireRole('renter'),
  asyncHandler(async (req, res) => {
    const renter = await getRenterById(req.user.id);
    res.json(renter);
  })
);

router.patch(
  '/me/bank-details',
  authenticate,
  requireRole('renter'),
  validateBody(bankDetailsSchema),
  asyncHandler(async (req, res) => {
    const renter = await updateBankDetails(req.user.id, req.body);
    res.json(renter);
  })
);

module.exports = router;
