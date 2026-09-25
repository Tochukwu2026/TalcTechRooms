const { withTransaction } = require('../../db/pool');
const { hashPassword } = require('../auth/passwords');
const { verifyIdentity } = require('../idVerification');
const ApiError = require('../../utils/ApiError');

/**
 * Registers a Renter: name, address, uploaded ID document, automatic ID verification.
 * Manual Admin approval is a SEPARATE later step (see modules/admin/adminService) - this
 * only creates the account and runs verification; approval_status stays 'pending' either way
 * (adminService.approveRenter refuses to approve unless verification succeeded).
 */
async function registerRenter({ email, phone, fullName, password, address, documentType, documentNumber }) {
  const passwordHash = await hashPassword(password);

  return withTransaction(async (client) => {
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      throw new ApiError(409, 'An account with this email already exists.');
    }

    const userResult = await client.query(
      `INSERT INTO users (role, email, phone, password_hash, full_name)
       VALUES ('renter', $1, $2, $3, $4)
       RETURNING id, role, email, full_name, created_at`,
      [email, phone, passwordHash, fullName]
    );
    const user = userResult.rows[0];

    await client.query(
      `INSERT INTO renters (user_id, address, approval_status)
       VALUES ($1, $2, 'pending')`,
      [user.id, address]
    );

    // Automatic ID verification. Run inside the same transaction's logical flow, but the
    // provider call itself is an external HTTP call (or the mock), not a DB operation.
    const verification = await verifyIdentity({ documentType, documentNumber, fullName });

    const verificationResult = await client.query(
      `INSERT INTO id_verifications
         (user_id, document_type, document_number, status, provider, provider_reference, cost_naira, verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, status, provider, cost_naira, verified_at`,
      [
        user.id,
        documentType,
        documentNumber,
        verification.status,
        verification.provider,
        verification.providerReference,
        verification.costNaira,
        verification.verifiedAt,
      ]
    );

    return {
      user,
      approvalStatus: 'pending',
      idVerification: verificationResult.rows[0],
    };
  });
}

async function getRenterById(userId) {
  const { pool } = require('../../db/pool');
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.phone, u.full_name, r.address, r.approval_status,
            r.approved_at, r.rejection_reason, r.bank_name, r.bank_account_number,
            r.bank_account_name
     FROM users u JOIN renters r ON r.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );
  if (rows.length === 0) {
    throw new ApiError(404, 'Renter not found.');
  }
  return rows[0];
}

/**
 * Lets a Renter supply/update the bank account their payouts get sent to (see
 * spec/decisions-and-phasing.md > Renter Payout). No verification of the bank details
 * themselves happens here (e.g. no Paystack "resolve account number" call) - if the details are
 * wrong, the payout attempt itself will fail and land in admin review (see
 * modules/payout/payoutService.releasePayoutForBooking), which is the same failure path a
 * genuinely-wrong-but-well-formed account number would hit anyway.
 */
async function updateBankDetails(userId, { bankName, bankAccountNumber, bankAccountName }) {
  const { pool } = require('../../db/pool');
  const { rows } = await pool.query(
    `UPDATE renters
     SET bank_name = $2, bank_account_number = $3, bank_account_name = $4
     WHERE user_id = $1
     RETURNING user_id, bank_name, bank_account_number, bank_account_name`,
    [userId, bankName, bankAccountNumber, bankAccountName]
  );
  if (rows.length === 0) {
    throw new ApiError(404, 'Renter not found.');
  }
  return rows[0];
}

module.exports = { registerRenter, getRenterById, updateBankDetails };
