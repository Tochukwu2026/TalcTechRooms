const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const createApp = require('../../src/app');
const { pool } = require('../../src/db/pool');
const { cleanDatabase, closeDatabase } = require('./testHelpers');

const app = createApp();

test.beforeEach(async () => {
  await cleanDatabase();
});

test.after(async () => {
  await cleanDatabase();
  await closeDatabase();
});

async function makeAdmin() {
  // Directly insert an admin user (there's no public admin-registration endpoint by design -
  // admins are provisioned out of band) and log in through the real /auth/login route so the
  // test exercises the same code path production traffic uses.
  const { hashPassword } = require('../../src/modules/auth/passwords');
  const passwordHash = await hashPassword('admin-password-123');
  await pool.query(
    `INSERT INTO users (role, email, phone, password_hash, full_name)
     VALUES ('admin', 'admin@talctech.example', '08010000000', $1, 'Admin User')`,
    [passwordHash]
  );

  const res = await request(app)
    .post('/auth/login')
    .send({ email: 'admin@talctech.example', password: 'admin-password-123' });
  return res.body.token;
}

test('Renter registration is rejected until manually approved, and rejected if ID verification failed', async () => {
  // Register a renter whose document number ends in '0' -> mock provider fails verification.
  const failingRegister = await request(app).post('/renters/register').send({
    email: 'failing-renter@example.com',
    fullName: 'Failing Renter',
    password: 'super-secret-1',
    address: '1 Bad Rd, Lagos',
    documentType: 'nin',
    documentNumber: '11111111110',
  });
  assert.equal(failingRegister.status, 201);
  assert.equal(failingRegister.body.idVerification.status, 'failed');
  assert.equal(failingRegister.body.approvalStatus, 'pending');

  const adminToken = await makeAdmin();

  // Admin cannot approve a renter whose ID verification failed.
  const rejectedApproveAttempt = await request(app)
    .post(`/admin/renters/${failingRegister.body.user.id}/approve`)
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(rejectedApproveAttempt.status, 400);
});

test('Renter registration -> ID verified -> admin approval end-to-end', async () => {
  const register = await request(app).post('/renters/register').send({
    email: 'good-renter@example.com',
    fullName: 'Good Renter',
    password: 'super-secret-1',
    address: '1 Good Rd, Lagos',
    documentType: 'nin',
    documentNumber: '11111111119', // does not end in 0 -> mock provider verifies
  });
  assert.equal(register.status, 201);
  assert.equal(register.body.idVerification.status, 'verified');
  assert.equal(register.body.approvalStatus, 'pending');

  const adminToken = await makeAdmin();

  // Shows up in the pending queue.
  const pending = await request(app)
    .get('/admin/renters/pending')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(pending.status, 200);
  assert.equal(pending.body.length, 1);
  assert.equal(pending.body[0].email, 'good-renter@example.com');

  // Approve it.
  const approve = await request(app)
    .post(`/admin/renters/${register.body.user.id}/approve`)
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(approve.status, 200);
  assert.equal(approve.body.approval_status, 'approved');

  // No longer in the pending queue.
  const pendingAfter = await request(app)
    .get('/admin/renters/pending')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(pendingAfter.body.length, 0);

  // Renter can now log in and see their own approved status.
  const login = await request(app)
    .post('/auth/login')
    .send({ email: 'good-renter@example.com', password: 'super-secret-1' });
  assert.equal(login.status, 200);

  const me = await request(app)
    .get('/renters/me')
    .set('Authorization', `Bearer ${login.body.token}`);
  assert.equal(me.status, 200);
  assert.equal(me.body.approval_status, 'approved');
});

test('Non-admin cannot access the admin renter-approval endpoints', async () => {
  const register = await request(app).post('/renters/register').send({
    email: 'renter2@example.com',
    fullName: 'Renter Two',
    password: 'super-secret-1',
    address: '2 Rd, Lagos',
    documentType: 'nin',
    documentNumber: '22222222229',
  });

  const login = await request(app)
    .post('/auth/login')
    .send({ email: 'renter2@example.com', password: 'super-secret-1' });

  const attempt = await request(app)
    .get('/admin/renters/pending')
    .set('Authorization', `Bearer ${login.body.token}`);
  assert.equal(attempt.status, 403);
  assert.ok(register.body); // silence unused var lint
});

test('Registering with a duplicate email is rejected with 409', async () => {
  const payload = {
    email: 'dupe@example.com',
    fullName: 'Dupe One',
    password: 'super-secret-1',
    address: '1 Rd, Lagos',
    documentType: 'nin',
    documentNumber: '33333333339',
  };
  const first = await request(app).post('/renters/register').send(payload);
  assert.equal(first.status, 201);

  const second = await request(app).post('/renters/register').send(payload);
  assert.equal(second.status, 409);
});
