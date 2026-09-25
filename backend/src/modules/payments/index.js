// Provider-agnostic payments interface, mirroring src/modules/idVerification and
// src/modules/storage's shape. Callers use these functions and never touch
// mockProvider/paystackProvider directly, so switching PAYSTACK_MODE in .env is the only thing
// needed to go from mock to real Paystack - no call-site changes.
const crypto = require('crypto');
const config = require('../../config');
const mockProvider = require('./mockProvider');
const paystackProvider = require('./paystackProvider');

function provider() {
  return config.payments.mode === 'paystack' ? paystackProvider : mockProvider;
}

/**
 * Starts a charge for a booking (or the Executive subscription). Returns an
 * authorizationUrl the client redirects the Customer to (Paystack's hosted checkout page in
 * real mode; a fake local URL in mock mode, since there's no real page to redirect to yet).
 * @param {{amountKobo:number, email:string, reference:string, metadata:object}} params
 */
async function initializeCharge({ amountKobo, email, reference, metadata }) {
  return provider().initializeCharge({ amountKobo, email, reference, metadata });
}

/**
 * Checks what actually happened to a previously-initialized charge. Used both by the
 * customer-triggered "verify" endpoint (the app's own fallback) and the Paystack webhook
 * handler (the primary, real-world trigger) - both call this same function so a charge is
 * only ever finalized once, from whichever path gets there first.
 * @returns {Promise<{provider:string, reference:string, status:'success'|'failed'|'not_found', amountKobo:number|null, paidAt:string|null, metadata:object|null, raw:object}>}
 */
async function verifyCharge(reference) {
  return provider().verifyCharge(reference);
}

/** A unique reference to hand Paystack for a new charge - not a booking id, since no booking
 * row exists yet at this point (a booking only exists after payment - see decisions log). */
function generateReference(prefix = 'ttr') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
}

/**
 * Pays a Renter out via Paystack's Transfer API (spec/decisions-and-phasing.md > Renter
 * Payout) - deliberately NOT the instant-split feature (subaccounts + split_code), which the
 * decisions log explicitly rules out. Used by src/modules/payout for both payout paths (Path
 * A's held-until-9pm release and Path B's instant release on a no-refund cancellation).
 * @param {{amountKobo:number, accountNumber:string, bankName:string, accountName:string, reference:string, reason:string}} params
 * @returns {Promise<{provider:string, status:'success'|'failed', transferReference:string|null, raw:object}>}
 */
async function initiateTransfer({ amountKobo, accountNumber, bankName, accountName, reference, reason }) {
  return provider().initiateTransfer({ amountKobo, accountNumber, bankName, accountName, reference, reason });
}

/**
 * Webhook signature check - only meaningful in real ('paystack') mode, since mock mode has no
 * real webhook secret and nothing will ever call the webhook route with a genuine signature in
 * dev/test. In mock mode this always passes, so the webhook route can still be exercised in
 * tests without a real signature.
 */
function verifyWebhookSignature(rawBody, signatureHeader) {
  if (config.payments.mode !== 'paystack') return true;
  return paystackProvider.verifyWebhookSignature(rawBody, signatureHeader);
}

module.exports = {
  initializeCharge,
  verifyCharge,
  generateReference,
  verifyWebhookSignature,
  initiateTransfer,
};
