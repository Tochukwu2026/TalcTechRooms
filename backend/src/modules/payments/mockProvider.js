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
    raw: { note: 'mock provider - no real API call made', ...charge },
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

module.exports = { initializeCharge, verifyCharge, initiateTransfer };
