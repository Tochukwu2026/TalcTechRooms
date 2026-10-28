const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { login } = require('../modules/auth/authService');
const { authenticate } = require('../middleware/auth');
const { deleteAccount } = require('../modules/auth/accountDeletionService');
const { loginSchema, deleteAccountSchema, validateBody } = require('./validation');

const router = Router();

router.post(
  '/login',
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const result = await login(req.body);
    res.json(result);
  })
);

// Self-service account deletion (Customers and Renters). Anonymises the account and keeps the
// money records - see modules/auth/accountDeletionService.js.
router.post(
  '/delete-account',
  authenticate,
  validateBody(deleteAccountSchema),
  asyncHandler(async (req, res) => {
    res.json(await deleteAccount(req.user.id, req.user.role, req.body.password));
  })
);

module.exports = router;
