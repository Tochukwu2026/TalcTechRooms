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

test('Checkout preview for a 1-night, 1-unit stay at N20,000/night matches the decisions-log worked example', async () => {
  const { token } = await makeApprovedRenter();
  const id = await createListing(token, { nightlyRentNaira: 20000 });

  const res = await request(app)
    .get(`/accommodations/${id}/checkout-preview`)
    .query({ checkIn: '2026-10-05', checkOut: '2026-10-06', units: 1 });
  assert.equal(res.status, 200);
  assert.equal(res.body.nights, 1);
  assert.equal(res.body.rentNaira, 20000);
  assert.equal(res.body.adminCostsNaira, 105.9);
  assert.equal(res.body.vatNaira, 1507.94);
  assert.equal(res.body.totalChargedNaira, 21613.84);
  assert.equal(res.body.commissionNaira, 3000);
  assert.equal(res.body.renterGrossPayoutNaira, 17000);
  assert.equal(res.body.unitsAvailable, 3);
});

test('Checkout preview scales rent by nights and units requested', async () => {
  const { token } = await makeApprovedRenter();
  const id = await createListing(token, { nightlyRentNaira: 20000 });

  const res = await request(app)
    .get(`/accommodations/${id}/checkout-preview`)
    .query({ checkIn: '2026-10-05', checkOut: '2026-10-08', units: 2 }); // 3 nights x 2 units
  assert.equal(res.status, 200);
  assert.equal(res.body.nights, 3);
  assert.equal(res.body.rentNaira, 120000); // 20000 * 3 * 2
});

test('Checkout preview rejects requesting more units than the listing has, or than are available', async () => {
  const { token } = await makeApprovedRenter();
  const id = await createListing(token, { numberOfUnits: 2, nightlyRentNaira: 20000 });

  const tooMany = await request(app)
    .get(`/accommodations/${id}/checkout-preview`)
    .query({ checkIn: '2026-10-05', checkOut: '2026-10-06', units: 5 });
  assert.equal(tooMany.status, 400);
});

test('Checkout preview 404s for an unknown listing and 422s on bad dates', async () => {
  const notFound = await request(app)
    .get('/accommodations/999999/checkout-preview')
    .query({ checkIn: '2026-10-05', checkOut: '2026-10-06' });
  assert.equal(notFound.status, 404);

  const { token } = await makeApprovedRenter();
  const id = await createListing(token);
  const badDates = await request(app)
    .get(`/accommodations/${id}/checkout-preview`)
    .query({ checkIn: '2026-10-06', checkOut: '2026-10-05' });
  assert.equal(badDates.status, 422);
});

test('GET /customers/executive-subscription-cost returns the N10,863.84/month worked example', async () => {
  const res = await request(app).get('/customers/executive-subscription-cost');
  assert.equal(res.status, 200);
  assert.equal(res.body.baseFeeNaira, 10000);
  assert.equal(res.body.adminCostsNaira, 105.9);
  assert.equal(res.body.vatNaira, 757.94);
  assert.equal(res.body.totalChargedNaira, 10863.84);
});
