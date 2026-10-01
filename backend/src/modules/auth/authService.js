const { pool } = require('../../db/pool');
const { verifyPassword } = require('./passwords');
const { signToken } = require('./jwt');
const ApiError = require('../../utils/ApiError');

async function login({ email, password }) {
  const { rows } = await pool.query(
    'SELECT id, role, email, full_name, password_hash FROM users WHERE email = $1',
    [email]
  );
  const user = rows[0];

  if (!user) {
    throw new ApiError(401, 'Invalid email or password.');
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    throw new ApiError(401, 'Invalid email or password.');
  }

  const token = signToken(user);
  const responseUser = { id: user.id, role: user.role, email: user.email, fullName: user.full_name };

  // Customer's `tier` ('regular' | 'executive') is included here so the mobile app can show/hide
  // the Executive-only Live/Video Viewing booking tab right after login, instead of discovering
  // the 403 only once the Customer taps into a listing (see viewingService.assertExecutiveCustomer
  // for the server-side enforcement this mirrors - this is purely for the client's own UI gating).
  if (user.role === 'customer') {
    const { rows: customerRows } = await pool.query('SELECT tier FROM customers WHERE user_id = $1', [user.id]);
    responseUser.tier = customerRows[0]?.tier ?? 'regular';
  }

  return { token, user: responseUser };
}

module.exports = { login };
