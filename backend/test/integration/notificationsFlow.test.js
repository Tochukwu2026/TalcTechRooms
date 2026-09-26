// Confirms the Termii live-integration wiring (mock mode - real credentials aren't available in
// this test environment) actually fires and logs an SMS + email on the two spec-required events:
// a real booking confirmation (bookingService.finalizeBooking) and a viewing confirmation
// (viewingService.bookViewing, both Video and Live). See src/modules/notifications.

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const createApp = require('../../src/app');
const { pool } = require('../../src/db/pool');
const { hashPassword } = require('../../src/modules/auth/passwords');
const { cleanDatabase, closeDatabase } = require('./testHelpers');

const app = createApp();

test.beforeEach(async () => {
  await cleanDatabase();
});

test.after(async () => {
  await cleanDatabase();
  await closeDatabase();
});

async function makeApprovedRenter(email = 'renter@example.com') {
  const passwordHash = await hashPassword('super-secret-1');
  const userResult = await pool.query(
    `INSERT INTO users (role, email, phone, password_hash, full_name)
     VALUES ('renter', $1, '08010000000', $2, 'A Renter') RETURNING id`,
    [email, passwordHash]
  );
  const userId = userResult.rows[0].id;
  await pool.query(
    `INSERT INTO renters (user_id, address, approval_status) VALUES ($1, '1 Rd, Lagos', 'approved')`,
    [userId]
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

// phone must NOT end in '0' - the mock notifications provider deterministically fails SMS sends
// to a number ending in '0' (see src/modules/notifications/mockProvider.js), same convention
// used for the mock ID-verification/payments providers elsewhere in this codebase.
async function registerCustomer(email = 'jane@example.com', overrides = {}) {
  const payload = {
    email,
    phone: '08020000001',
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

test('A real booking confirmation logs a sent SMS and a sent email to the Customer', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const listingId = await createListing(renterToken);
  const { userId: customerUserId, token: customerToken } = await registerCustomer();

  const init = await request(app)
    .post(`/accommodations/${listingId}/bookings/initialize`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ checkIn: '2026-10-05', checkOut: '2026-10-06', units: 1 });
  assert.equal(init.status, 201, JSON.stringify(init.body));

  const verify = await request(app)
    .post(`/bookings/verify/${init.body.reference}`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send();
  assert.equal(verify.status, 201, JSON.stringify(verify.body));

  const { rows } = await pool.query(
    `SELECT channel, type, status, cost_naira FROM notifications_log WHERE user_id = $1 ORDER BY channel`,
    [customerUserId]
  );
  assert.equal(rows.length, 2);
  const sms = rows.find((r) => r.channel === 'sms');
  const email = rows.find((r) => r.channel === 'email');
  assert.equal(sms.type, 'booking_confirmation');
  assert.equal(sms.status, 'sent');
  assert.equal(Number(sms.cost_naira), 5.9);
  assert.equal(email.type, 'booking_confirmation');
  assert.equal(email.status, 'sent');
  assert.equal(Number(email.cost_naira), 0);
});

test('A Customer whose phone ends in 0 gets a failed (not thrown/blocking) SMS notification logged', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const listingId = await createListing(renterToken);
  const { userId: customerUserId, token: customerToken } = await registerCustomer('fails-sms@example.com', {
    phone: '08020000000',
  });

  const init = await request(app)
    .post(`/accommodations/${listingId}/bookings/initialize`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ checkIn: '2026-10-05', checkOut: '2026-10-06', units: 1 });
  const verify = await request(app)
    .post(`/bookings/verify/${init.body.reference}`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send();
  // The booking itself still succeeds - a notification failure never blocks the response.
  assert.equal(verify.status, 201, JSON.stringify(verify.body));

  const { rows } = await pool.query(
    `SELECT status FROM notifications_log WHERE user_id = $1 AND channel = 'sms'`,
    [customerUserId]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'failed');
});

test('A Video Viewing confirmation logs a sent SMS and a sent email to the Executive Customer', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const listingId = await createListing(renterToken);
  const { userId: customerUserId, token: customerToken } = await registerCustomer('exec@example.com', {
    tier: 'executive',
  });

  const scheduledDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const res = await request(app)
    .post(`/accommodations/${listingId}/viewings`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ viewingType: 'video', scheduledDate });
  assert.equal(res.status, 201, JSON.stringify(res.body));

  const { rows } = await pool.query(
    `SELECT channel, type, status FROM notifications_log WHERE user_id = $1 ORDER BY channel`,
    [customerUserId]
  );
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.type === 'viewing_confirmation' && r.status === 'sent'));
});
