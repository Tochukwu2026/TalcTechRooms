// Self-service account deletion for Customers and Renters (Google Play requires an in-app way to
// do this, and the Privacy Policy promises it).
//
// Decided with the founder 2026-10-28:
//  - ANONYMISE, don't hard-delete. The person's name, email, phone, ID number, address and bank
//    details are wiped and login is closed, but the users row and the money records (bookings,
//    charges, refunds, payouts) stay, with no name attached, because TalcTech must keep
//    financial records for several years (see the Privacy Policy's retention section).
//  - BLOCK while anything is still open (a stay that hasn't ended, a viewing that hasn't
//    happened, a payout not yet settled) so nobody who has paid is left stranded.
//  - Requires the account password, same protection as changing the email or password.

const crypto = require('crypto');
const { pool } = require('../../db/pool');
const ApiError = require('../../utils/ApiError');
const { hashPassword, verifyPassword } = require('./passwords');

const DELETABLE_ROLES = ['customer', 'renter'];

const BLOCKED_MESSAGE_PREFIX = 'You cannot delete your account yet: ';

async function findBlockers(client, userId, role) {
  const reasons = [];

  if (role === 'customer') {
    const stays = await client.query(
      `SELECT 1 FROM bookings
        WHERE customer_user_id = $1 AND status = 'active' AND check_out_date >= CURRENT_DATE
        LIMIT 1`,
      [userId]
    );
    if (stays.rows.length > 0) {
      reasons.push('you have a booked stay that has not ended. Wait until it is over (or cancel it first).');
    }

    const viewings = await client.query(
      `SELECT 1 FROM viewing_bookings
        WHERE customer_user_id = $1 AND status = 'scheduled' AND scheduled_date >= CURRENT_DATE
        LIMIT 1`,
      [userId]
    );
    if (viewings.rows.length > 0) {
      reasons.push('you have an upcoming viewing. Cancel it or wait until it has happened.');
    }
  }

  if (role === 'renter') {
    const stays = await client.query(
      `SELECT 1 FROM bookings b
         JOIN accommodations a ON a.id = b.accommodation_id
        WHERE a.renter_user_id = $1
          AND b.status IN ('active', 'checked_in_confirmed')
          AND (b.check_out_date >= CURRENT_DATE OR b.payout_status IN ('held', 'admin_review'))
        LIMIT 1`,
      [userId]
    );
    if (stays.rows.length > 0) {
      reasons.push('a guest has an upcoming stay at one of your listings, or a payout to you is still being settled.');
    }

    const viewings = await client.query(
      `SELECT 1 FROM viewing_bookings v
         JOIN accommodations a ON a.id = v.accommodation_id
        WHERE a.renter_user_id = $1 AND v.status = 'scheduled' AND v.scheduled_date >= CURRENT_DATE
        LIMIT 1`,
      [userId]
    );
    if (viewings.rows.length > 0) {
      reasons.push('a viewing of one of your listings is still scheduled.');
    }
  }

  return reasons;
}

/**
 * @param {number|string} userId
 * @param {string} role  'customer' | 'renter' (from the verified token)
 * @param {string} password  the account's current password
 */
async function deleteAccount(userId, role, password) {
  if (!DELETABLE_ROLES.includes(role)) {
    throw new ApiError(403, 'This type of account cannot be deleted from the app. Contact TalcTech support.');
  }
  if (!password) {
    throw new ApiError(400, 'Enter your password to delete your account.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the row so two simultaneous delete requests (or a delete during a booking) serialise.
    const { rows } = await client.query(
      'SELECT id, password_hash, deleted_at FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );
    const user = rows[0];
    if (!user || user.deleted_at) {
      throw new ApiError(404, 'Account not found.');
    }
    if (!(await verifyPassword(password, user.password_hash))) {
      throw new ApiError(403, 'Your password is incorrect.');
    }

    const blockers = await findBlockers(client, userId, role);
    if (blockers.length > 0) {
      throw new ApiError(409, `${BLOCKED_MESSAGE_PREFIX}${blockers.join(' ')}`);
    }

    // --- Wipe personal data ---
    const scrambledPassword = await hashPassword(crypto.randomBytes(32).toString('hex'));
    await client.query(
      `UPDATE users
          SET email = $2,
              phone = NULL,
              full_name = 'Deleted user',
              password_hash = $3,
              is_active = false,
              deleted_at = now(),
              updated_at = now()
        WHERE id = $1`,
      // .invalid is a reserved TLD, so this can never be a real mailbox.
      [userId, `deleted-${userId}@deleted.invalid`, scrambledPassword]
    );

    await client.query(
      `UPDATE id_verifications SET document_number = 'REMOVED', provider_reference = NULL WHERE user_id = $1`,
      [userId]
    );
    await client.query(`UPDATE notifications_log SET payload = '{}'::jsonb WHERE user_id = $1`, [userId]);

    if (role === 'customer') {
      await client.query('UPDATE customers SET gender = NULL, updated_at = now() WHERE user_id = $1', [userId]);
      // Stop any further charges and drop the saved-card token (brand/last4 are card details too).
      await client.query(
        `UPDATE executive_subscriptions
            SET status = CASE WHEN status = 'active' THEN 'canceled'::subscription_status ELSE status END,
                canceled_at = COALESCE(canceled_at, now()),
                auto_renew = false,
                paystack_authorization_code = NULL,
                card_brand = NULL,
                card_last4 = NULL,
                card_reusable = NULL
          WHERE customer_user_id = $1`,
        [userId]
      );
    }

    if (role === 'renter') {
      await client.query(
        `UPDATE renters
            SET address = 'Removed',
                bank_name = NULL,
                bank_account_number = NULL,
                bank_account_name = NULL,
                updated_at = now()
          WHERE user_id = $1`,
        [userId]
      );
      // Take every listing off the market and hide the Renter's contact details on it. The
      // listing rows stay because past bookings point at them.
      await client.query(
        `UPDATE accommodations
            SET is_active = false, contact_info = 'Removed', updated_at = now()
          WHERE renter_user_id = $1`,
        [userId]
      );
      await client.query(
        `DELETE FROM viewing_availability
          WHERE is_booked = false
            AND accommodation_id IN (SELECT id FROM accommodations WHERE renter_user_id = $1)`,
        [userId]
      );
    }

    await client.query('COMMIT');
    return { deleted: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { deleteAccount };
