const test = require('node:test');
const assert = require('node:assert/strict');
const mockProvider = require('../../src/modules/notifications/mockProvider');

test('mock provider: an SMS to a number NOT ending in 0 deterministically succeeds', async () => {
  const result = await mockProvider.sendSms({ to: '08010000001', message: 'Hello' });
  assert.equal(result.status, 'success');
  assert.ok(result.messageId);
});

test('mock provider: an SMS to a number ending in 0 deterministically fails', async () => {
  const result = await mockProvider.sendSms({ to: '08010000000', message: 'Hello' });
  assert.equal(result.status, 'failed');
  assert.equal(result.messageId, null);
});

test('mock provider: an email NOT containing "+fail" deterministically succeeds', async () => {
  const result = await mockProvider.sendEmail({ to: 'jane@example.com', subject: 'Hi', variables: {} });
  assert.equal(result.status, 'success');
  assert.ok(result.messageId);
});

test('mock provider: an email containing "+fail" deterministically fails', async () => {
  const result = await mockProvider.sendEmail({ to: 'jane+fail@example.com', subject: 'Hi', variables: {} });
  assert.equal(result.status, 'failed');
  assert.equal(result.messageId, null);
});
