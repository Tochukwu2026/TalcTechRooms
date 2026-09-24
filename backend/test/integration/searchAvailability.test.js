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

async function makeApprovedCustomer(email = 'customer@example.com') {
  const passwordHash = await hashPassword('super-secret-1');
  const userResult = await pool.query(
    `INSERT INTO users (role, email, phone, password_hash, full_name)
     VALUES ('customer', $1, '08020000000', $2, 'A Customer') RETURNING id`,
    [email, passwordHash]
  );
  const userId = userResult.rows[0].id;
  await pool.query(`INSERT INTO customers (user_id, tier) VALUES ($1, 'regular')`, [userId]);
  return userId;
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
    nightlyRentNaira: 25000,
    ...overrides,
  };
  const res = await request(app).post('/accommodations').set('Authorization', `Bearer ${token}`).send(payload);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id;
}

// Inserts a booking row directly - no booking-creation endpoint exists yet (checkout math /
// Paystack aren't built), so this stands in for one to exercise the availability math.
async function insertBooking(accommodationId, customerUserId, checkIn, checkOut, unitsBooked, status = 'active') {
  await pool.query(
    `INSERT INTO bookings
       (accommodation_id, customer_user_id, check_in_date, check_out_date, units_booked,
        rent_naira, admin_costs_naira, vat_naira, total_charged_naira,
        commission_naira, renter_gross_payout_naira, renter_net_payout_naira, status)
     VALUES ($1, $2, $3, $4, $5, 1000, 100, 75, 1175, 150, 850, 850, $6)`,
    [accommodationId, customerUserId, checkIn, checkOut, unitsBooked, status]
  );
}

test('Search returns only active listings matching state/area/type/price filters', async () => {
  const { token } = await makeApprovedRenter();
  await createListing(token, { area: 'Lekki', nightlyRentNaira: 25000 });
  const viId = await createListing(token, { area: 'Victoria Island', nightlyRentNaira: 32000 });

  const byArea = await request(app).get('/accommodations/search').query({ area: 'Victoria Island' });
  assert.equal(byArea.status, 200);
  assert.equal(byArea.body.length, 1);
  assert.equal(byArea.body[0].id, viId);
  assert.equal(byArea.body[0].contact_info, undefined);

  const byPrice = await request(app).get('/accommodations/search').query({ minPrice: 30000 });
  assert.equal(byPrice.status, 200);
  assert.equal(byPrice.body.length, 1);
  assert.equal(byPrice.body[0].id, viId);

  const byType = await request(app).get('/accommodations/search').query({ type: 'bungalow' });
  assert.equal(byType.status, 200);
  assert.equal(byType.body.length, 0);
});

test('Search rejects checkIn without checkOut, and checkOut before checkIn', async () => {
  const missingCheckOut = await request(app).get('/accommodations/search').query({ checkIn: '2026-10-05' });
  assert.equal(missingCheckOut.status, 422);

  const reversed = await request(app)
    .get('/accommodations/search')
    .query({ checkIn: '2026-10-10', checkOut: '2026-10-05' });
  assert.equal(reversed.status, 422);
});

test('Search with dates annotates results with unitsAvailableForDates', async () => {
  const { token } = await makeApprovedRenter();
  const customerId = await makeApprovedCustomer();
  const id = await createListing(token, { numberOfUnits: 3 });

  // Overlapping booking for 2 of the 3 units.
  await insertBooking(id, customerId, '2026-10-05', '2026-10-08', 2);

  const overlapping = await request(app)
    .get('/accommodations/search')
    .query({ checkIn: '2026-10-06', checkOut: '2026-10-09' });
  assert.equal(overlapping.status, 200);
  assert.equal(overlapping.body[0].unitsAvailableForDates, 1);

  const nonOverlapping = await request(app)
    .get('/accommodations/search')
    .query({ checkIn: '2026-11-01', checkOut: '2026-11-03' });
  assert.equal(nonOverlapping.body[0].unitsAvailableForDates, 3);
});

test('GET /accommodations/:id/availability computes units left and nights, ignoring canceled bookings', async () => {
  const { token } = await makeApprovedRenter();
  const customerId = await makeApprovedCustomer();
  const id = await createListing(token, { numberOfUnits: 3, nightlyRentNaira: 25000 });

  const withNoBookings = await request(app)
    .get(`/accommodations/${id}/availability`)
    .query({ checkIn: '2026-10-05', checkOut: '2026-10-08' });
  assert.equal(withNoBookings.status, 200);
  assert.equal(withNoBookings.body.unitsAvailable, 3);
  assert.equal(withNoBookings.body.nights, 3);
  assert.equal(withNoBookings.body.nightlyRentNaira, 25000);

  await insertBooking(id, customerId, '2026-10-05', '2026-10-08', 2, 'active');
  // A canceled booking must NOT reduce availability.
  await insertBooking(id, customerId, '2026-10-05', '2026-10-08', 3, 'canceled_refundable');

  const withBooking = await request(app)
    .get(`/accommodations/${id}/availability`)
    .query({ checkIn: '2026-10-05', checkOut: '2026-10-08' });
  assert.equal(withBooking.body.unitsAvailable, 1);

  // Same-day checkout/check-in turnover: a stay starting the day the other ends does not overlap.
  const backToBack = await request(app)
    .get(`/accommodations/${id}/availability`)
    .query({ checkIn: '2026-10-08', checkOut: '2026-10-10' });
  assert.equal(backToBack.body.unitsAvailable, 3);
});

test('GET /accommodations/:id/availability 404s for an unknown or inactive listing', async () => {
  const res = await request(app)
    .get('/accommodations/999999/availability')
    .query({ checkIn: '2026-10-05', checkOut: '2026-10-08' });
  assert.equal(res.status, 404);
});
