// Real Paystack provider - see spec/decisions-and-phasing.md > Platform & Stack > Payments.
//
// IMPORTANT / NOT YET VERIFIED: this was written from Paystack's published REST API docs
// (Initialize Transaction / Verify Transaction), without real PAYSTACK_SECRET_KEY /
// PAYSTACK_PUBLIC_KEY credentials to test against - same caveat pattern as
// src/modules/idVerification/premblyProvider.js and src/modules/storage/gcsProvider.js.
// Before switching PAYSTACK_MODE from 'mock' to 'paystack' in any real environment:
//   1. Confirm the exact request/response shape against Paystack's current docs - they may
//      have changed since this was written.
//   2. Run a real Initialize + Verify round trip against Paystack's own test mode (using their
//      published test cards) and confirm the response shape matches what this file expects.
//   3. Wire up webhook signature verification for real (see verifyWebhookSignature below) -
//      it's implemented per Paystack's documented scheme but never exercised against a real
//      webhook payload/secret.

const crypto = require('crypto');
const config = require('../../config');

async function initializeCharge({ amountKobo, email, reference, metadata }) {
  const { secretKey, baseUrl } = config.payments.paystack;
  if (!secretKey) {
    throw new Error(
      'PAYSTACK_SECRET_KEY is not set. Set PAYSTACK_MODE=mock in .env until real Paystack ' +
        'credentials are available.'
    );
  }

  const response = await fetch(`${baseUrl}/transaction/initialize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ amount: amountKobo, email, reference, metadata }),
  });
  const body = await response.json();

  if (!response.ok || !body.status) {
    throw new Error(`Paystack initialize failed: ${body.message || response.statusText}`);
  }

  return {
    provider: 'paystack',
    authorizationUrl: body.data.authorization_url,
    accessCode: body.data.access_code,
    reference: body.data.reference,
  };
}

async function verifyCharge(reference) {
  const { secretKey, baseUrl } = config.payments.paystack;
  if (!secretKey) {
    throw new Error(
      'PAYSTACK_SECRET_KEY is not set. Set PAYSTACK_MODE=mock in .env until real Paystack ' +
        'credentials are available.'
    );
  }

  const response = await fetch(`${baseUrl}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  const body = await response.json();

  if (!response.ok || !body.status) {
    return {
      provider: 'paystack',
      reference,
      status: 'failed',
      amountKobo: null,
      paidAt: null,
      metadata: null,
      raw: body,
    };
  }

  const data = body.data;
  return {
    provider: 'paystack',
    reference,
    // Paystack's own statuses: success, failed, abandoned, reversed, etc. - only 'success'
    // counts as paid; everything else is treated as a plain failure for booking purposes.
    status: data.status === 'success' ? 'success' : 'failed',
    amountKobo: data.amount,
    paidAt: data.paid_at || null,
    metadata: data.metadata || null,
    raw: data,
  };
}

/**
 * Verifies Paystack's `x-paystack-signature` webhook header: HMAC-SHA512 of the raw request
 * body, keyed with the secret key, per Paystack's documented webhook security scheme.
 * `rawBody` must be the exact bytes Paystack sent (a Buffer/string) - not a re-serialized JSON
 * object, since re-serializing can change whitespace/key order and break the signature match.
 */
function verifyWebhookSignature(rawBody, signatureHeader) {
  const { secretKey } = config.payments.paystack;
  if (!secretKey || !signatureHeader) return false;
  const expected = crypto.createHmac('sha512', secretKey).update(rawBody).digest('hex');
  return expected === signatureHeader;
}

/**
 * Pays a Renter out via Paystack's Transfer API - a real two-step flow:
 *   1. POST /transferrecipient - registers (or re-registers) the Renter's bank account as a
 *      "transfer recipient" and gets back a recipient_code.
 *   2. POST /transfer - actually moves money to that recipient_code.
 * Paystack does let you cache a recipient_code and skip step 1 on repeat payouts, but this
 * always re-creates the recipient first for simplicity (Paystack treats re-creating the same
 * account/bank pair as a no-op, returning the existing recipient) - revisit if that turns out to
 * add a real problem (e.g. a rate limit) once real payouts are actually happening.
 *
 * IMPORTANT / NOT YET VERIFIED, same caveat as initializeCharge/verifyCharge above, PLUS an
 * extra one specific to this function:
 *   `bankName` here is whatever free-text a Renter typed into their bank details (see
 *   renterService.updateBankDetails) - e.g. "GTBank" or "Guaranty Trust Bank" - but Paystack's
 *   /transferrecipient endpoint wants a `bank_code` (a short numeric code from Paystack's own
 *   GET /bank list, e.g. "058" for GTBank), not a bank name. This function passes bankName
 *   through as `bank_code` as a placeholder so the shape lines up with the docs, but that WILL
 *   fail against the real API as written. Before switching PAYSTACK_MODE to 'paystack':
 *   4. Either (a) call GET /bank once, build a name-to-code lookup table, and store the real
 *      bank_code on the renters row when bank details are submitted, instead of/alongside the
 *      free-text bank name; or (b) resolve bankName to a bank_code here at call time.
 *   5. Confirm whether Paystack's transfer requires the platform to be whitelisted/approved for
 *      live transfers first (their docs describe an approval step for the Transfers API on some
 *      account tiers) - this has not been checked.
 */
async function initiateTransfer({ amountKobo, accountNumber, bankName, accountName, reference, reason }) {
  const { secretKey, baseUrl } = config.payments.paystack;
  if (!secretKey) {
    throw new Error(
      'PAYSTACK_SECRET_KEY is not set. Set PAYSTACK_MODE=mock in .env until real Paystack ' +
        'credentials are available.'
    );
  }

  const recipientResponse = await fetch(`${baseUrl}/transferrecipient`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'nuban',
      name: accountName,
      account_number: accountNumber,
      // See the caveat above - this is a placeholder, not a real Paystack bank_code yet.
      bank_code: bankName,
      currency: 'NGN',
    }),
  });
  const recipientBody = await recipientResponse.json();

  if (!recipientResponse.ok || !recipientBody.status) {
    return {
      provider: 'paystack',
      status: 'failed',
      transferReference: null,
      raw: { step: 'transferrecipient', ...recipientBody },
    };
  }

  const recipientCode = recipientBody.data.recipient_code;

  const transferResponse = await fetch(`${baseUrl}/transfer`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source: 'balance',
      amount: amountKobo,
      recipient: recipientCode,
      reference,
      reason,
    }),
  });
  const transferBody = await transferResponse.json();

  if (!transferResponse.ok || !transferBody.status) {
    return {
      provider: 'paystack',
      status: 'failed',
      transferReference: reference,
      raw: { step: 'transfer', ...transferBody },
    };
  }

  // Paystack's transfer statuses include 'success' (instant, common for balance-funded
  // transfers) and 'pending'/'otp' (require further action, e.g. OTP finalization on some
  // account types) - only 'success' is treated as a completed payout here; anything else is
  // surfaced as a failure so it lands in admin review rather than being silently assumed to have
  // gone through. Revisit if TalcTech's Paystack account ever requires OTP-finalized transfers.
  return {
    provider: 'paystack',
    status: transferBody.data.status === 'success' ? 'success' : 'failed',
    transferReference: reference,
    raw: transferBody.data,
  };
}

/**
 * Refunds a previously-successful charge via Paystack's Refund API (POST /refund, keyed by the
 * original transaction reference - no bank/recipient details needed, unlike initiateTransfer,
 * since Paystack returns the money to the original payment method itself).
 *
 * IMPORTANT / NOT YET VERIFIED, same caveat as the other functions in this file - written from
 * Paystack's published Refunds docs, never called with real credentials. One thing specifically
 * worth confirming before relying on this in production: Paystack's refund is asynchronous for
 * some payment channels (their docs describe a `processed`/`pending` distinction) - this treats
 * only an immediate 'processed' response as success and anything else (including 'pending') as a
 * failure so it's surfaced rather than silently assumed to have gone through; if pending refunds
 * turn out to be the common case in practice, this will need a webhook-driven confirmation step
 * instead (Paystack does send a `refund.processed` webhook event).
 */
async function initiateRefund({ amountKobo, reference, reason }) {
  const { secretKey, baseUrl } = config.payments.paystack;
  if (!secretKey) {
    throw new Error(
      'PAYSTACK_SECRET_KEY is not set. Set PAYSTACK_MODE=mock in .env until real Paystack ' +
        'credentials are available.'
    );
  }

  const response = await fetch(`${baseUrl}/refund`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ transaction: reference, amount: amountKobo, merchant_note: reason }),
  });
  const body = await response.json();

  if (!response.ok || !body.status) {
    return {
      provider: 'paystack',
      status: 'failed',
      refundReference: null,
      raw: body,
    };
  }

  return {
    provider: 'paystack',
    status: body.data.status === 'processed' ? 'success' : 'failed',
    refundReference: String(body.data.id ?? reference),
    raw: body.data,
  };
}

module.exports = {
  initializeCharge,
  verifyCharge,
  verifyWebhookSignature,
  initiateTransfer,
  initiateRefund,
};
