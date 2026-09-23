const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const createApp = require('../../src/app');
const { cleanDatabase, closeDatabase } = require('./testHelpers');

const app = createApp();

test.beforeEach(async () => {
  await cleanDatabase();
});

test.after(async () => {
  await cleanDatabase();
  await closeDatabase();
});

test('Customer registration is instant/active once ID verification passes - no admin queue involved', async () => {
  const register = await request(app).post('/customers/register').send({
    email: 'customer@example.com',
    fullName: 'A Customer',
    password: 'super-secret-1',
    gender: 'female',
    tier: 'regular',
    documentType: 'passport',
    documentNumber: 'B1234569', // does not end in 0 -> verified
  });
  assert.equal(register.status, 201);
  assert.equal(register.body.active, true);
  assert.equal(register.body.idVerification.status, 'verified');

  const login = await request(app)
    .post('/auth/login')
    .send({ email: 'customer@example.com', password: 'super-secret-1' });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.role, 'customer');
});

test('Customer registration surfaces a failed ID verification instead of silently succeeding', async () => {
  const register = await request(app).post('/customers/register').send({
    email: 'customer-fail@example.com',
    fullName: 'A Customer',
    password: 'super-secret-1',
    tier: 'executive',
    documentType: 'pvc',
    documentNumber: 'PVC00000', // ends in 0 -> mock provider fails
  });
  assert.equal(register.status, 201);
  assert.equal(register.body.active, false);
  assert.equal(register.body.idVerification.status, 'failed');
});

test('Registration validation rejects a weak password and missing fields with 422', async () => {
  const res = await request(app).post('/customers/register').send({
    email: 'not-an-email',
    password: '123',
  });
  assert.equal(res.status, 422);
  assert.ok(res.body.details);
});
