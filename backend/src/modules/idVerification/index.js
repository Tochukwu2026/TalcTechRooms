// Provider-agnostic ID verification interface. Callers use verifyIdentity(...) and never
// touch mockProvider/premblyProvider directly, so switching PREMBLY_MODE in .env is the only
// thing needed to go from mock to real verification - no call-site changes.
const config = require('../../config');
const mockProvider = require('./mockProvider');
const premblyProvider = require('./premblyProvider');

const VALID_DOCUMENT_TYPES = ['nin', 'passport', 'pvc'];

/**
 * @param {{documentType: 'nin'|'passport'|'pvc', documentNumber: string, fullName: string}} input
 * @returns {Promise<{provider: string, providerReference: string|null, status: 'verified'|'failed', costNaira: number, verifiedAt: string|null, raw: object}>}
 */
async function verifyIdentity(input) {
  if (!VALID_DOCUMENT_TYPES.includes(input.documentType)) {
    throw new Error(`Unsupported document type: ${input.documentType}`);
  }

  const provider = config.idVerification.mode === 'prembly' ? premblyProvider : mockProvider;
  return provider.verify(input);
}

module.exports = { verifyIdentity, VALID_DOCUMENT_TYPES };
