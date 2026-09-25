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

module.exports = { initializeCharge, verifyCharge, verifyWebhookSignature };
