const test = require('node:test');
const assert = require('node:assert/strict');
const mockProvider = require('../../src/modules/payments/mockProvider');

test('mock provider: a normal email initializes and verifies as a successful charge', async () => {
  const init = await mockProvider.initializeCharge({
    amountKobo: 2161384,
    email: 'jane@example.com',
    reference: 'test_ref_success_1',
    metadata: { foo: 'bar' },
  });
  assert.equal(init.reference, 'test_ref_success_1');
  assert.ok(init.authorizationUrl.includes('test_ref_success_1'));

  const verified = await mockProvider.verifyCharge('test_ref_success_1');
  assert.equal(verified.status, 'success');
  assert.equal(verified.amountKobo, 2161384);
  assert.deepEqual(verified.metadata, { foo: 'bar' });
  assert.ok(verified.paidAt);
});

test('mock provider: an email containing "+fail" deterministically simulates a declined charge', async () => {
  await mockProvider.initializeCharge({
    amountKobo: 2161384,
    email: 'jane+fail@example.com',
    reference: 'test_ref_fail_1',
    metadata: { foo: 'bar' },
  });

  const verified = await mockProvider.verifyCharge('test_ref_fail_1');
  assert.equal(verified.status, 'failed');
  assert.equal(verified.paidAt, null);
});

test('mock provider: verifying an unknown reference returns not_found rather than throwing', async () => {
  const verified = await mockProvider.verifyCharge('never_initialized_ref');
  assert.equal(verified.status, 'not_found');
});

test('mock provider: a bank account number NOT ending in 0 deterministically simulates a successful transfer', async () => {
  const result = await mockProvider.initiateTransfer({
    amountKobo: 1700000,
    accountNumber: '0123456789',
    bankName: 'GTBank',
    accountName: 'Jane Renter',
    reference: 'test_payout_ref_success_1',
  });
  assert.equal(result.status, 'success');
  assert.equal(result.transferReference, 'test_payout_ref_success_1');
});

test('mock provider: a bank account number ending in 0 deterministically simulates a failed transfer', async () => {
  const result = await mockProvider.initiateTransfer({
    amountKobo: 1700000,
    accountNumber: '0123456780',
    bankName: 'GTBank',
    accountName: 'Jane Renter',
    reference: 'test_payout_ref_fail_1',
  });
  assert.equal(result.status, 'failed');
});
