// Real Prembly (IdentityPass) provider, via their API Integration product - see
// spec/decisions-and-phasing.md > ID Verification Provider.
//
// IMPORTANT / NOT YET VERIFIED: this was written from Prembly's published API Integration
// docs, without real PREMBLY_APP_ID / PREMBLY_API_KEY credentials to test against (per the
// decisions log, real credentials weren't available yet as of the last build session).
// Before switching PREMBLY_MODE from 'mock' to 'prembly' in production:
//   1. Confirm the exact endpoint paths/payload shape against Prembly's current docs -
//      they may have changed since this was written.
//   2. Confirm whether NIN Basic (assumed here, ~N50) actually includes the name-match
//      check this app needs, or whether NIN Advance (~N100) is required - this is an open
//      question in spec/decisions-and-phasing.md, not yet resolved with Prembly.
//   3. Run a real verification against a test document for each of the three types
//      (NIN, Passport, PVC) and confirm the response shape matches what this file expects.

const config = require('../../config');

const ENDPOINTS = {
  nin: '/identitypass/verification/vnin',
  passport: '/identitypass/verification/passport',
  pvc: '/identitypass/verification/pvc',
};

const COSTS_NAIRA = {
  nin: 50,
  passport: 100,
  pvc: 500,
};

async function verify({ documentType, documentNumber, fullName }) {
  const { appId, apiKey, baseUrl } = config.idVerification.prembly;

  if (!appId || !apiKey) {
    throw new Error(
      'PREMBLY_APP_ID / PREMBLY_API_KEY are not set. Set PREMBLY_MODE=mock in .env until ' +
        'real Prembly credentials are available.'
    );
  }

  const endpoint = ENDPOINTS[documentType];
  if (!endpoint) {
    throw new Error(`Unsupported document type for Prembly verification: ${documentType}`);
  }

  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'app-id': appId,
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      number: documentNumber,
      // Prembly's name-match check compares this against the record on file - unconfirmed
      // whether NIN Basic includes this comparison, see the caveat at the top of this file.
      full_name: fullName,
    }),
  });

  const body = await response.json();

  if (!response.ok || body.status !== 'success' || body.response?.verification?.status !== 'VERIFIED') {
    return {
      provider: 'prembly',
      providerReference: body.id || body.request_id || null,
      status: 'failed',
      costNaira: COSTS_NAIRA[documentType],
      verifiedAt: null,
      raw: body,
    };
  }

  return {
    provider: 'prembly',
    providerReference: body.id || body.request_id || null,
    status: 'verified',
    costNaira: COSTS_NAIRA[documentType],
    verifiedAt: new Date().toISOString(),
    raw: body,
  };
}

module.exports = { verify };
