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

module.exports = { listPendingRenters, approveRenter, rejectRenter };
