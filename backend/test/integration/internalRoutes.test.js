// process.env.SCHEDULER_SECRET must be set before src/config (and anything requiring it) is
// required, since config reads it once at module-load time - node:test runs each test file in
// its own subprocess, so this doesn't leak into other test files.
process.env.SCHEDULER_SECRET = 'test-scheduler-secret-abc123';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const createApp = require('../../src/app');
const { pool } = require('../../src/db/pool');
const { hashPassword } = require('../../src/modules/auth/passwords');
const { cleanDatabase, closeDatabase } = require('./testHelpers');
const { todayInWat } = require('../../src/modules/payout/payoutService');

function tomorrowInWat() {
  return new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const app = createApp();

test.beforeEach(async () => {
  await cleanDatabase();
});

test.after(async () => {
  await cleanDatabase();
  await closeDatabase();
});

async function makeApprovedRenter(email = 'renter@example.com', bankAccountNumber = '0123456781') {
  const passwordHash = await hashPassword('super-secret-1');
  const userResult = await pool.query(
    `INSERT INTO users (role, email, phone, password_hash, full_name)
     VALUES ('renter', $1, '08010000000', $2, 'A Renter') RETURNING id`,
    [email, passwordHash]
  );
  const userId = userResult.rows[0].id;
  await pool.query(
    `INSERT INTO renters (user_id, address, approval_status, bank_name, bank_account_number, bank_account_name)
     VALUES ($1, '1 Rd, Lagos', 'approved', 'GTBank', $2, 'A Renter')`,
    [userId, bankAccountNumber]
  );
  const login = await request(app).post('/auth/login').send({ email, password: 'super-secret-1' });
  return { userId, token: login.body.token };
}

async function createListing(token, overrides = {}) {
  const payload = {
    type: 'studio',
    state: 'Lagos',
    area: 'Lekki',
    locationText: 'Lekki Phase 1, off Admiralty Way',
    description: 'A lovely studio apartment close to the beach.',
    contactInfo: '+2348010000000',
    numberOfUnits: 3,
    nightlyRentNaira: 20000,
    ...overrides,
  };
  const res = await request(app).post('/accommodations').set('Authorization', `Bearer ${token}`).send(payload);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id;
}

async function registerCustomer(email = 'jane@example.com', overrides = {}) {
  const payload = {
    email,
    phone: '08020000000',
    fullName: 'Jane Customer',
    password: 'super-secret-1',
    documentType: 'nin',
    documentNumber: '12345678901',
    ...overrides,
  };
  const res = await request(app).post('/customers/register').send(payload);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const login = await request(app).post('/auth/login').send({ email, password: payload.password });
  return { userId: res.body.user.id, token: login.body.token };
}

async function createPaidBooking(renterToken, customerToken, { checkIn = '2026-10-05', checkOut = '2026-10-06' } = {}) {
  const listingId = await createListing(renterToken);
  const init = await request(app)
    .post(`/accommodations/${listingId}/bookings/initialize`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ checkIn, checkOut, units: 1 });
  assert.equal(init.status, 201, JSON.stringify(init.body));
  const verify = await request(app)
    .post(`/bookings/verify/${init.body.reference}`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send();
  assert.equal(verify.status, 201, JSON.stringify(verify.body));
  return verify.body.id;
}

test('POST /internal/evaluate-payouts with no X-Scheduler-Secret header is rejected', async () => {
  const res = await request(app).post('/internal/evaluate-payouts').send();
  assert.equal(res.status, 401);
});

test('POST /internal/evaluate-payouts with the wrong secret is rejected', async () => {
  const res = await request(app)
    .post('/internal/evaluate-payouts')
    .set('X-Scheduler-Secret', 'not-the-real-secret')
    .send();
  assert.equal(res.status, 401);
});

test('POST /internal/evaluate-payouts with the correct secret runs the real evaluation end-to-end', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const { token: customerToken } = await registerCustomer();
  // check-in date is "today" (WAT) - neither confirmed nor reported - the job should flag it,
  // proving this HTTP endpoint actually invokes evaluateCheckInDayPayouts() for real rather than
  // just returning a canned response.
  const bookingId = await createPaidBooking(renterToken, customerToken, {
    checkIn: todayInWat(),
    checkOut: tomorrowInWat(),
  });

  const res = await request(app)
    .post('/internal/evaluate-payouts')
    .set('X-Scheduler-Secret', 'test-scheduler-secret-abc123')
    .send();
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.evaluatedDate, todayInWat());
  assert.ok(res.body.flaggedBookingIds.includes(bookingId));

  const { rows } = await pool.query('SELECT status, payout_status FROM bookings WHERE id = $1', [bookingId]);
  assert.equal(rows[0].status, 'active');
  assert.equal(rows[0].payout_status, 'admin_review');

  const { rows: caseRows } = await pool.query(
    `SELECT reason, status FROM admin_review_cases WHERE booking_id = $1`,
    [bookingId]
  );
  assert.equal(caseRows.length, 1);
  assert.equal(caseRows[0].reason, 'no_show_no_response');
});
