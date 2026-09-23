const { verifyToken } = require('../modules/auth/jwt');
const ApiError = require('../utils/ApiError');

/**
 * Populates req.user = { id, role, email } from a valid `Authorization: Bearer <token>`
 * header. Throws 401 if missing/invalid - does not silently continue as anonymous, since
 * every route that uses this expects a logged-in user.
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new ApiError(401, 'Missing or malformed Authorization header.'));
  }

  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, role: payload.role, email: payload.email };
    return next();
  } catch (err) {
    return next(new ApiError(401, 'Invalid or expired token.'));
  }
}

/**
 * Role guard factory - use after `authenticate`. Example:
 *   router.get('/admin/renters', authenticate, requireRole('admin'), handler)
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new ApiError(401, 'Not authenticated.'));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(new ApiError(403, 'You do not have permission to perform this action.'));
    }
    return next();
  };
}

module.exports = { authenticate, requireRole };
