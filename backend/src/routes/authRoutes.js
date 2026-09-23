const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { login } = require('../modules/auth/authService');
const { loginSchema, validateBody } = require('./validation');

const router = Router();

router.post(
  '/login',
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const result = await login(req.body);
    res.json(result);
  })
);

module.exports = router;
