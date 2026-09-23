const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { registerCustomer } = require('../modules/customers/customerService');
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

module.exports = router;
