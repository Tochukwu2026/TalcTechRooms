const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword } = require('../../src/modules/auth/passwords');
const { signToken, verifyToken } = require('../../src/modules/auth/jwt');

test('hashPassword + verifyPassword round-trip', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.notEqual(hash, 'correct horse battery staple');
  assert.equal(await verifyPassword('correct horse battery staple', hash), true);
  assert.equal(await verifyPassword('wrong password', hash), false);
});

test('signToken + verifyToken round-trip carries role and email', () => {
  const token = signToken({ id: 42, role: 'admin', email: 'admin@talctech.example' });
  const payload = verifyToken(token);
  assert.equal(payload.sub, 42);
  assert.equal(payload.role, 'admin');
  assert.equal(payload.email, 'admin@talctech.example');
});

test('verifyToken rejects a tampered token', () => {
  const token = signToken({ id: 1, role: 'customer', email: 'c@example.com' });
  const tampered = token.slice(0, -2) + 'xx';
  assert.throws(() => verifyToken(tampered));
});
