const { verifyToken } = require('../modules/auth/jwt');
const { pool } = require('../db/pool');
const ApiError = require('../utils/ApiError');

/**
 * Populates req.user = { id, role, email } from a valid `Authorization: Bearer <token>`
 * header. Throws 401 if missing/invalid - does not silently continue as anonymous, since
 * every route that uses this expects a logged-in user.
 *
 * Also checks `is_active` against the DB on every request (not just at login). A JWT stays
 * valid until it expires, so without this check an Admin deactivating someone's account
 * wouldn't take effect until that person's existing token ran out - possibly hours/days later.
 * This extra query is an acceptable cost at this app's scale; see
 * spec/decisions-and-phasing.md > Build Phasing for the founder's decision that deactivation
 * must cut off an already-signed-in session immediately.
 */
async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new ApiError(401, 'Missing or malformed Authorization header.'));
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    return next(new ApiError(401, 'Invalid or expired token.'));
  }

  try {
    const { rows } = await pool.query('SELECT is_active FROM users WHERE id = $1', [payload.sub]);
    if (rows.length === 0 || !rows[0].is_active) {
      return next(new ApiError(403, 'This account has been deactivated. Contact TalcTech support.'));
    }
  } catch (err) {
    return next(err);
  }

  req.user = { id: payload.sub, role: payload.role, email: payload.email };
  return next();
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
