const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyIdentity } = require('../../src/modules/idVerification');

test('mock provider verifies a normal-looking document number', async () => {
  const result = await verifyIdentity({
    documentType: 'nin',
    documentNumber: '12345678901',
    fullName: 'Jane Doe',
  });
  assert.equal(result.status, 'verified');
  assert.equal(result.provider, 'mock');
  assert.equal(result.costNaira, 50);
  assert.ok(result.verifiedAt);
});

test('mock provider fails a document number ending in 0 (deterministic failure case)', async () => {
  const result = await verifyIdentity({
    documentType: 'passport',
    documentNumber: 'A1234560',
    fullName: 'Jane Doe',
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.costNaira, 100);
  assert.equal(result.verifiedAt, null);
});

test('rejects an unsupported document type', async () => {
  await assert.rejects(
    () => verifyIdentity({ documentType: 'drivers_licence', documentNumber: '123', fullName: 'X' }),
    /Unsupported document type/
  );
});
