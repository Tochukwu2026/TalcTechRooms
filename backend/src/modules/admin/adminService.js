const { pool } = require('../../db/pool');
const ApiError = require('../../utils/ApiError');

async function listPendingRenters() {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.phone, u.full_name, r.address, r.approval_status, r.created_at,
            iv.status AS id_verification_status, iv.document_type, iv.verified_at
     FROM renters r
     JOIN users u ON u.id = r.user_id
     LEFT JOIN LATERAL (
       SELECT status, document_type, verified_at
       FROM id_verifications
       WHERE user_id = r.user_id
       ORDER BY created_at DESC
       LIMIT 1
     ) iv ON true
     WHERE r.approval_status = 'pending'
     ORDER BY r.created_at ASC`
  );
  return rows;
}

async function approveRenter({ renterUserId, adminUserId }) {
  const verificationResult = await pool.query(
    `SELECT status FROM id_verifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [renterUserId]
  );
  const latestVerification = verificationResult.rows[0];

  if (!latestVerification || latestVerification.status !== 'verified') {
    throw new ApiError(
      400,
      'This Renter has not passed automatic ID verification yet and cannot be approved.'
    );
  }

  const { rows } = await pool.query(
    `UPDATE renters
     SET approval_status = 'approved', approved_by = $2, approved_at = now(), updated_at = now()
     WHERE user_id = $1 AND approval_status = 'pending'
     RETURNING user_id, approval_status, approved_at`,
    [renterUserId, adminUserId]
  );

  if (rows.length === 0) {
    throw new ApiError(404, 'Pending renter not found (already approved/rejected, or does not exist).');
  }

  return rows[0];
}

async function rejectRenter({ renterUserId, adminUserId, reason }) {
  const { rows } = await pool.query(
    `UPDATE renters
     SET approval_status = 'rejected', approved_by = $2, approved_at = now(),
         rejection_reason = $3, updated_at = now()
     WHERE user_id = $1 AND approval_status = 'pending'
     RETURNING user_id, approval_status, rejection_reason`,
    [renterUserId, adminUserId, reason || null]
  );

  if (rows.length === 0) {
    throw new ApiError(404, 'Pending renter not found (already approved/rejected, or does not exist).');
  }

  return rows[0];
}

// --- Staff directory (for the Admin's "assign staff" viewing dropdown - see viewingService) ---

async function listStaff() {
  const { rows } = await pool.query(
    `SELECT id, email, full_name FROM users WHERE role = 'staff' ORDER BY full_name ASC`
  );
  return rows;
}

// --- Price Cap management (spec/decisions-and-phasing.md > Admin Portal) ---

async function listPriceCaps() {
  const { rows } = await pool.query(
    'SELECT id, state, area, cap_naira FROM price_caps ORDER BY state ASC, area ASC NULLS FIRST'
  );
  return rows;
}

/**
 * Adjusts an existing location's cap. Deliberately does not allow changing state/area on an
 * existing row (those are its identity - accommodations reference it by id, and the Lagos
 * picklist / flat-state-cap logic elsewhere assumes state+area is stable) - creating a new
 * location goes through createPriceCap below instead.
 */
async function updatePriceCap(id, capNaira) {
  const { rows } = await pool.query(
    'UPDATE price_caps SET cap_naira = $1 WHERE id = $2 RETURNING id, state, area, cap_naira',
    [capNaira, id]
  );
  if (rows.length === 0) {
    throw new ApiError(404, 'Price cap not found.');
  }
  return rows[0];
}

/**
 * Adds a new supported location (e.g. a 12th Lagos area, or a new state). Uses the same
 * (state, COALESCE(area, '')) unique index as the seed data (src/db/migrations/0009_*) so this
 * can't silently create a duplicate flat-state-cap row; re-posting an existing location just
 * updates its cap instead of erroring.
 */
async function createPriceCap({ state, area, capNaira }) {
  const { rows } = await pool.query(
    `INSERT INTO price_caps (state, area, cap_naira) VALUES ($1, $2, $3)
     ON CONFLICT (state, (COALESCE(area, ''))) DO UPDATE SET cap_naira = EXCLUDED.cap_naira
     RETURNING id, state, area, cap_naira`,
    [state, area || null, capNaira]
  );
  return rows[0];
}

// --- Admin-editable business settings (commission %, VAT %, admin fee, SMS cost, etc.) ---

async function listSettings() {
  const { rows } = await pool.query(
    'SELECT key, value, description, updated_at FROM admin_settings ORDER BY key ASC'
  );
  return rows;
}

async function updateSetting(key, value) {
  const { rows } = await pool.query(
    `UPDATE admin_settings SET value = $1, updated_at = now() WHERE key = $2
     RETURNING key, value, description, updated_at`,
    [String(value), key]
  );
  if (rows.length === 0) {
    throw new ApiError(404, `Unknown setting: ${key}`);
  }
  return rows[0];
}

// --- Account deactivation/reactivation (spec/decisions-and-phasing.md > Build Phasing) ---
// Admin-only, soft (reversible) - a deactivated account can't log in (see authService.login
// and the authenticate middleware's own is_active check, which also cuts off an
// already-signed-in session immediately rather than waiting for its token to expire) but every
// row it owns (bookings, listings, payout/viewing history) is untouched, and its email stays
// reserved to it rather than being freed for a new signup - so reactivating is a true undo.

async function listUsers({ role, search } = {}) {
  const conditions = [];
  const params = [];
  if (role) {
    params.push(role);
    conditions.push(`role = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(email ILIKE $${params.length} OR full_name ILIKE $${params.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT id, role, email, full_name, phone, is_active, created_at
     FROM users
     ${where}
     ORDER BY created_at DESC`,
    params
  );
  return rows;
}

async function deactivateUser({ userId, adminUserId }) {
  if (Number(userId) === Number(adminUserId)) {
    throw new ApiError(400, 'You cannot deactivate your own account.');
  }
  const { rows } = await pool.query(
    `UPDATE users SET is_active = false, updated_at = now()
     WHERE id = $1
     RETURNING id, role, email, full_name, is_active`,
    [userId]
  );
  if (rows.length === 0) {
    throw new ApiError(404, 'User not found.');
  }
  return rows[0];
}

async function reactivateUser(userId) {
  const { rows } = await pool.query(
    `UPDATE users SET is_active = true, updated_at = now()
     WHERE id = $1
     RETURNING id, role, email, full_name, is_active`,
    [userId]
  );
  if (rows.length === 0) {
    throw new ApiError(404, 'User not found.');
  }
  return rows[0];
}

module.exports = {
  listPendingRenters,
  approveRenter,
  rejectRenter,
  listStaff,
  listPriceCaps,
  updatePriceCap,
  createPriceCap,
  listSettings,
  updateSetting,
  listUsers,
  deactivateUser,
  reactivateUser,
};
