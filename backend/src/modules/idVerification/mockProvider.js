// Mock ID verification provider - used until real Prembly credentials exist
// (config.idVerification.mode === 'mock', the default). Deterministic so tests are stable:
// any document number ending in the digit '0' fails verification, everything else passes.
// This lets the rest of the app (registration flow, admin approval gate) be built and tested
// end-to-end before Prembly access is set up.

const COSTS_NAIRA = {
  nin: 50, // NIN Basic - see spec/decisions-and-phasing.md re: unverified assumption on tier
  passport: 100,
  pvc: 500,
};

async function verify({ documentType, documentNumber, fullName }) {
  const fails = documentNumber.trim().endsWith('0');

  return {
    provider: 'mock',
    providerReference: `mock_${documentType}_${Date.now()}`,
    status: fails ? 'failed' : 'verified',
    costNaira: COSTS_NAIRA[documentType],
    verifiedAt: fails ? null : new Date().toISOString(),
    raw: { documentType, documentNumber, fullName, note: 'mock provider - no real API call made' },
  };
}

module.exports = { verify };
