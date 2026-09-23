const { withTransaction } = require('../../db/pool');
const { hashPassword } = require('../auth/passwords');
const { verifyIdentity } = require('../idVerification');
const ApiError = require('../../utils/ApiError');

/**
 * Registers a Customer. Unlike Renters, Customers get instant/automatic access once ID
 * validation passes - no manual review queue. If verification fails, the account still
 * exists (so the person isn't locked out of retrying), but the caller should treat a
 * 'failed' idVerification.status in the response as "not yet allowed to book" and prompt
 * re-submission via a future "resubmit ID" endpoint (not yet built - see Still to build).
 */
async function registerCustomer({ email, phone, fullName, password, gender, tier, documentType, documentNumber }) {
  const passwordHash = await hashPassword(password);
  const resolvedTier = tier === 'executive' ? 'executive' : 'regular';

  return withTransaction(async (client) => {
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      throw new ApiError(409, 'An account with this email already exists.');
    }

    const userResult = await client.query(
      `INSERT INTO users (role, email, phone, password_hash, full_name)
       VALUES ('customer', $1, $2, $3, $4)
       RETURNING id, role, email, full_name, created_at`,
      [email, phone, passwordHash, fullName]
    );
    const user = userResult.rows[0];

    await client.query(
      `INSERT INTO customers (user_id, tier, gender)
       VALUES ($1, $2, $3)`,
      [user.id, resolvedTier, gender || null]
    );

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
      tier: resolvedTier,
      active: verification.status === 'verified',
      idVerification: verificationResult.rows[0],
    };
  });
}

module.exports = { registerCustomer };
