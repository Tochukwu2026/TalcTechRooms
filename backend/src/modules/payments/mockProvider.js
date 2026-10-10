// Mock Paystack provider - used until real Paystack credentials exist (config.payments.mode
// === 'mock', the default). Mirrors src/modules/idVerification/mockProvider.js's shape.
//
// Real Paystack decides success/failure at the hosted checkout page, when the Customer enters
// a card - there's no such page here yet (the mobile app isn't built, and this backend has no
// front-end), so there's nothing to key a "test card" off of. Instead, deterministic like the
// ID-verification mock (a document number ending in '0' fails): any Customer email containing
// "+fail" right before the @ (e.g. "jane+fail@example.com") simulates a declined charge;
// everything else simulates success. This lets booking creation, the verify step, the webhook
// handler, and failure handling all be built and tested end-to-end before real Paystack
// credentials are wired up. Revisit once a real checkout page/SDK is integrated - at that
// point success/failure will genuinely come from Paystack, and this email convention goes away.

const charges = new Map(); // in-process only - reference -> charge record. Fine for a single
// test run/dev server; not durable across restarts (matches "mock" being a stand-in, not a
// real payment ledger).

function simulatesFailure(email) {
  return /\+fail@/i.test(email || '');
}

async function initializeCharge({ amountKobo, email, reference, metadata }) {
  const willFail = simulatesFailure(email);
  charges.set(reference, {
    amountKobo,
    email,
    metadata,
    status: willFail ? 'failed' : 'success',
    paidAt: willFail ? null : new Date().toISOString(),
  });

  return {
    provider: 'mock',
    authorizationUrl: `https://mock-paystack.local/checkout/${reference}`,
    accessCode: `mock_access_${reference}`,
    reference,
  };
}

async function verifyCharge(reference) {
  const charge = charges.get(reference);
  if (!charge) {
    return {
      provider: 'mock',
      reference,
      status: 'not_found',
      amountKobo: null,
      paidAt: null,
      metadata: null,
      raw: { note: 'mock provider - no charge was ever initialized with this reference' },
    };
  }

  return {
    provider: 'mock',
    reference,
    status: charge.status, // 'success' | 'failed'
    amountKobo: charge.amountKobo,
    paidAt: charge.paidAt,
    metadata: charge.metadata,
    raw: {
      note: 'mock provider - no real API call made',
      ...charge,
      // Same shape as the `authorization` block Paystack returns on a successful card charge.
      authorization:
        charge.status === 'success'
          ? { authorization_code: `AUTH_mock_${reference}`, brand: 'visa', last4: '4081', reusable: true }
          : null,
    },
  };
}

// Renewal charge on a saved card. An email containing "+renewfail" right before the @ simulates a
// declined renewal (card expired / insufficient funds); everything else succeeds.
async function chargeAuthorization({ amountKobo, email, authorizationCode, reference, metadata }) {
  const willFail = /\+renewfail@/i.test(email || '');
  charges.set(reference, {
    amountKobo,
    email,
    metadata,
    status: willFail ? 'failed' : 'success',
    paidAt: willFail ? null : new Date().toISOString(),
  });
  return {
    provider: 'mock',
    status: willFail ? 'failed' : 'success',
    reference,
    raw: { note: 'mock provider - no real API call made', authorizationCode },
  };
}

// Same trick as the mock ID-verification provider (a document number ending in '0' fails):
// a Renter bank account number ending in '0' deterministically simulates a failed transfer,
// so payout failure-handling (src/modules/payout) can be built and tested without real bank
// details or a real Paystack Transfer call.
function simulatesTransferFailure(accountNumber) {
  return /0$/.test(String(accountNumber || ''));
}

async function initiateTransfer({ amountKobo, accountNumber, bankName, accountName, reference }) {
  const willFail = simulatesTransferFailure(accountNumber);
  return {
    provider: 'mock',
    status: willFail ? 'failed' : 'success',
    transferReference: reference,
    raw: {
      note: 'mock provider - no real API call made',
      amountKobo,
      accountNumber,
      bankName,
      accountName,
    },
  };
}

// Refunds a previously-verified charge by its own reference. Unlike the ID-verification/
// bank-account mocks above, there's no user-supplied input to key a deterministic
// success/failure convention off of here - a refund's own "does this charge exist" check is
// itself the natural thing to fail on, so that's what this does: succeeds for any reference this
// mock actually saw succeed via initializeCharge, fails otherwise.
async function initiateRefund({ amountKobo, reference }) {
  const charge = charges.get(reference);
  if (!charge || charge.status !== 'success') {
    return {
      provider: 'mock',
      status: 'failed',
      refundReference: null,
      raw: { note: 'mock provider - no successful charge found for this reference' },
    };
  }
  return {
    provider: 'mock',
    status: 'success',
    refundReference: `refund_${reference}`,
    raw: { note: 'mock provider - no real API call made', amountKobo, reference },
  };
}

module.exports = { initializeCharge, verifyCharge, chargeAuthorization, initiateTransfer, initiateRefund };
