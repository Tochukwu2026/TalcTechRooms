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
  return {
    token,
    user: { id: user.id, role: user.role, email: user.email, fullName: user.full_name },
  };
}

module.exports = { login };
