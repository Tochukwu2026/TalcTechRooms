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

// documentNumber must NOT end in '0' - the mock ID-verification provider fails those (see
// src/modules/idVerification/mockProvider.js) - booking creation requires a verified Customer.
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

test('Full booking flow: initialize -> verify -> a real bookings row matching the worked example', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const listingId = await createListing(renterToken, { nightlyRentNaira: 20000 });
  const { token: customerToken } = await registerCustomer();

  const init = await request(app)
    .post(`/accommodations/${listingId}/bookings/initialize`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ checkIn: '2026-10-05', checkOut: '2026-10-06', units: 1 });
  assert.equal(init.status, 201, JSON.stringify(init.body));
  assert.ok(init.body.reference);
  assert.ok(init.body.authorizationUrl.includes(init.body.reference));
  assert.equal(init.body.totalChargedNaira, 21613.84);

  const verify = await request(app)
    .post(`/bookings/verify/${init.body.reference}`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send();
  assert.equal(verify.status, 201, JSON.stringify(verify.body));
  assert.equal(verify.body.status, 'active');
  assert.equal(verify.body.payoutStatus, 'held');
  assert.equal(verify.body.rentNaira, 20000);
  assert.equal(verify.body.adminCostsNaira, 105.9);
  assert.equal(verify.body.vatNaira, 1507.94);
  assert.equal(verify.body.totalChargedNaira, 21613.84);
  assert.equal(verify.body.commissionNaira, 3000);
  assert.equal(verify.body.renterGrossPayoutNaira, 17000);
  assert.equal(verify.body.renterNetPayoutNaira, 17000);
  assert.equal(verify.body.unitsBooked, 1);

  const { rows } = await pool.query('SELECT count(*)::int AS n FROM bookings');
  assert.equal(rows[0].n, 1);
});

test('Verifying the same reference twice is idempotent - only one booking row is created', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const listingId = await createListing(renterToken);
  const { token: customerToken } = await registerCustomer();

  const init = await request(app)
    .post(`/accommodations/${listingId}/bookings/initialize`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ checkIn: '2026-10-05', checkOut: '2026-10-06', units: 1 });

  const first = await request(app)
    .post(`/bookings/verify/${init.body.reference}`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send();
  const second = await request(app)
    .post(`/bookings/verify/${init.body.reference}`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send();

  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(first.body.id, second.body.id);

  const { rows } = await pool.query('SELECT count(*)::int AS n FROM bookings');
  assert.equal(rows[0].n, 1);
});

test('A declined charge ("+fail" email) never creates a booking', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const listingId = await createListing(renterToken);
  const { token: customerToken } = await registerCustomer('jane+fail@example.com');

  const init = await request(app)
    .post(`/accommodations/${listingId}/bookings/initialize`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ checkIn: '2026-10-05', checkOut: '2026-10-06', units: 1 });
  assert.equal(init.status, 201);

  const verify = await request(app)
    .post(`/bookings/verify/${init.body.reference}`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send();
  assert.equal(verify.status, 402);
  assert.equal(verify.body.status, 'payment_failed');

  const { rows } = await pool.query('SELECT count(*)::int AS n FROM bookings');
  assert.equal(rows[0].n, 0);
});

test('A Customer whose ID verification failed cannot initialize a booking', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const listingId = await createListing(renterToken);
  // documentNumber ending in '0' fails the mock ID verification provider.
  const { token: customerToken } = await registerCustomer('unverified@example.com', { documentNumber: '1234567890' });

  const init = await request(app)
    .post(`/accommodations/${listingId}/bookings/initialize`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ checkIn: '2026-10-05', checkOut: '2026-10-06', units: 1 });
  assert.equal(init.status, 403);
});

test('A Renter cannot initialize a booking (customer-only route)', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const listingId = await createListing(renterToken);

  const init = await request(app)
    .post(`/accommodations/${listingId}/bookings/initialize`)
    .set('Authorization', `Bearer ${renterToken}`)
    .send({ checkIn: '2026-10-05', checkOut: '2026-10-06', units: 1 });
  assert.equal(init.status, 403);
});

test('Initializing a booking rejects bad dates (422) and an unknown listing (404)', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const listingId = await createListing(renterToken);
  const { token: customerToken } = await registerCustomer();

  const badDates = await request(app)
    .post(`/accommodations/${listingId}/bookings/initialize`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ checkIn: '2026-10-06', checkOut: '2026-10-05', units: 1 });
  assert.equal(badDates.status, 422);

  const notFound = await request(app)
    .post('/accommodations/999999/bookings/initialize')
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ checkIn: '2026-10-05', checkOut: '2026-10-06', units: 1 });
  assert.equal(notFound.status, 404);
});

test('A second Customer cannot book more units than remain once the first Customer is confirmed', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const listingId = await createListing(renterToken, { numberOfUnits: 1, nightlyRentNaira: 20000 });
  const { token: customer1Token } = await registerCustomer('first@example.com');
  const { token: customer2Token } = await registerCustomer('second@example.com');

  const init1 = await request(app)
    .post(`/accommodations/${listingId}/bookings/initialize`)
    .set('Authorization', `Bearer ${customer1Token}`)
    .send({ checkIn: '2026-10-05', checkOut: '2026-10-06', units: 1 });
  await request(app)
    .post(`/bookings/verify/${init1.body.reference}`)
    .set('Authorization', `Bearer ${customer1Token}`)
    .send();

  const init2 = await request(app)
    .post(`/accommodations/${listingId}/bookings/initialize`)
    .set('Authorization', `Bearer ${customer2Token}`)
    .send({ checkIn: '2026-10-05', checkOut: '2026-10-06', units: 1 });
  assert.equal(init2.status, 409);
});

test('An availability conflict at finalize time auto-refunds the Customer in full and creates no booking', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const listingId = await createListing(renterToken, { numberOfUnits: 1, nightlyRentNaira: 20000 });
  const { token: customer1Token } = await registerCustomer('first@example.com');
  const { token: customer2Token } = await registerCustomer('second@example.com');

  // Both Customers initialize while the single unit is still (correctly) reported available -
  // the race only becomes a real conflict once one of them actually finalizes first.
  const init1 = await request(app)
    .post(`/accommodations/${listingId}/bookings/initialize`)
    .set('Authorization', `Bearer ${customer1Token}`)
    .send({ checkIn: '2026-10-05', checkOut: '2026-10-06', units: 1 });
  const init2 = await request(app)
    .post(`/accommodations/${listingId}/bookings/initialize`)
    .set('Authorization', `Bearer ${customer2Token}`)
    .send({ checkIn: '2026-10-05', checkOut: '2026-10-06', units: 1 });
  assert.equal(init1.status, 201);
  assert.equal(init2.status, 201);

  const verify1 = await request(app)
    .post(`/bookings/verify/${init1.body.reference}`)
    .set('Authorization', `Bearer ${customer1Token}`)
    .send();
  assert.equal(verify1.status, 201, JSON.stringify(verify1.body));

  const verify2 = await request(app)
    .post(`/bookings/verify/${init2.body.reference}`)
    .set('Authorization', `Bearer ${customer2Token}`)
    .send();
  assert.equal(verify2.status, 409, JSON.stringify(verify2.body));
  assert.equal(verify2.body.status, 'availability_conflict_refunded');

  // Only customer1's booking exists.
  const { rows: bookingRows } = await pool.query('SELECT count(*)::int AS n FROM bookings');
  assert.equal(bookingRows[0].n, 1);

  // A refund row was recorded for the full amount, with no booking to attach to.
  const { rows: refundRows } = await pool.query(
    `SELECT booking_id, amount_naira, reason, paystack_charge_reference, paystack_refund_reference FROM refunds`
  );
  assert.equal(refundRows.length, 1);
  assert.equal(refundRows[0].booking_id, null);
  assert.equal(Number(refundRows[0].amount_naira), 21613.84); // full totalChargedNaira, not just Rent
  assert.equal(refundRows[0].reason, 'availability_conflict');
  assert.equal(refundRows[0].paystack_charge_reference, init2.body.reference);
  assert.ok(refundRows[0].paystack_refund_reference);
});

test('A Customer can fetch their own booking but not another Customer\'s', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const listingId = await createListing(renterToken);
  const { token: customer1Token } = await registerCustomer('owner@example.com');
  const { token: customer2Token } = await registerCustomer('stranger@example.com');

  const init = await request(app)
    .post(`/accommodations/${listingId}/bookings/initialize`)
    .set('Authorization', `Bearer ${customer1Token}`)
    .send({ checkIn: '2026-10-05', checkOut: '2026-10-06', units: 1 });
  const verify = await request(app)
    .post(`/bookings/verify/${init.body.reference}`)
    .set('Authorization', `Bearer ${customer1Token}`)
    .send();
  const bookingId = verify.body.id;

  const own = await request(app).get(`/bookings/${bookingId}`).set('Authorization', `Bearer ${customer1Token}`);
  assert.equal(own.status, 200);

  const stranger = await request(app)
    .get(`/bookings/${bookingId}`)
    .set('Authorization', `Bearer ${customer2Token}`);
  assert.equal(stranger.status, 403);
});

test('Verifying an unknown reference 404s', async () => {
  const { token: customerToken } = await registerCustomer();
  const res = await request(app)
    .post('/bookings/verify/never_initialized_ref')
    .set('Authorization', `Bearer ${customerToken}`)
    .send();
  assert.equal(res.status, 404);
});
