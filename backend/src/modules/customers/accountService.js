// A signed-in Customer's own account details: view, edit phone/email, change password.
//
// Deliberately NOT editable here (decided with the founder 2026-10-06): full name - it was
// matched against the Customer's verified ID at signup, so changing it would void that match.
//
// Email is also the login, and password protects the whole account, so changing either one
// requires the current password - a stolen/unlocked phone alone can't take the account over.
// (There is no email-confirmation step yet, so a new email is trusted as typed.)

const { pool } = require('../../db/pool');
const ApiError = require('../../utils/ApiError');
const { hashPassword, verifyPassword } = require('../auth/passwords');

async function getProfile(userId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.phone, u.full_name, c.tier
       FROM users u
       JOIN customers c ON c.user_id = u.id
      WHERE u.id = $1`,
    [userId]
  );
  if (rows.length === 0) {
    throw new ApiError(404, 'Customer account not found.');
  }
  const row = rows[0];

  const sub = await pool.query(
    `SELECT current_period_ends_at, auto_renew, card_brand, card_last4
       FROM executive_subscriptions
      WHERE customer_user_id = $1 AND status = 'active'
      ORDER BY started_at DESC
      LIMIT 1`,
    [userId]
  );

  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    fullName: row.full_name,
    tier: row.tier,
    executivePeriodEndsAt: sub.rows[0]?.current_period_ends_at ?? null,
    autoRenew: sub.rows[0] ? sub.rows[0].auto_renew : null,
    card: sub.rows[0]?.card_last4 ? { brand: sub.rows[0].card_brand, last4: sub.rows[0].card_last4 } : null,
  };
}

/**
 * Switches monthly auto-renewal on or off for the Customer's current Executive month. Off means
 * they keep Executive until that month ends, then become Regular (done by the renewal job).
 */
async function setAutoRenew(userId, autoRenew) {
  const { rowCount } = await pool.query(
    `UPDATE executive_subscriptions SET auto_renew = $2
      WHERE customer_user_id = $1 AND status = 'active'`,
    [userId, autoRenew]
  );
  if (rowCount === 0) {
    throw new ApiError(409, 'You do not have an active Executive subscription.');
  }
  return getProfile(userId);
}

async function assertCurrentPassword(userId, currentPassword) {
  if (!currentPassword) {
    throw new ApiError(400, 'Enter your current password to make this change.');
  }
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  const ok = rows[0] && (await verifyPassword(currentPassword, rows[0].password_hash));
  if (!ok) {
    throw new ApiError(403, 'Your current password is incorrect.');
  }
}

/**
 * @param {number|string} userId
 * @param {{email?:string, phone?:string|null, currentPassword?:string}} changes
 */
async function updateProfile(userId, { email, phone, currentPassword }) {
  const current = await getProfile(userId);

  const emailChanging = email !== undefined && email !== current.email;
  if (emailChanging) {
    await assertCurrentPassword(userId, currentPassword);
    const taken = await pool.query('SELECT id FROM users WHERE email = $1 AND id <> $2', [email, userId]);
    if (taken.rows.length > 0) {
      throw new ApiError(409, 'An account with this email already exists.');
    }
  }

  const sets = [];
  const values = [];
  if (emailChanging) {
    values.push(email);
    sets.push(`email = $${values.length}`);
  }
  if (phone !== undefined) {
    values.push(phone === '' ? null : phone);
    sets.push(`phone = $${values.length}`);
  }

  if (sets.length > 0) {
    values.push(userId);
    await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
  }

  return getProfile(userId);
}

async function changePassword(userId, { currentPassword, newPassword }) {
  await assertCurrentPassword(userId, currentPassword);
  if (currentPassword === newPassword) {
    throw new ApiError(400, 'Your new password must be different from your current one.');
  }
  const hash = await hashPassword(newPassword);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId]);
  return { changed: true };
}

module.exports = { getProfile, updateProfile, changePassword, setAutoRenew };
