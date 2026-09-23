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

async function makePendingRenter(email = 'pending-renter@example.com') {
  const passwordHash = await hashPassword('super-secret-1');
  const userResult = await pool.query(
    `INSERT INTO users (role, email, phone, password_hash, full_name)
     VALUES ('renter', $1, '08010000001', $2, 'Pending Renter') RETURNING id`,
    [email, passwordHash]
  );
  const userId = userResult.rows[0].id;
  await pool.query(
    `INSERT INTO renters (user_id, address, approval_status) VALUES ($1, '2 Rd, Lagos', 'pending')`,
    [userId]
  );
  const login = await request(app).post('/auth/login').send({ email, password: 'super-secret-1' });
  return { userId, token: login.body.token };
}

const validPayload = {
  type: 'studio',
  state: 'Lagos',
  area: 'Lekki',
  locationText: 'Lekki Phase 1, off Admiralty Way',
  description: 'A lovely studio apartment close to the beach.',
  contactInfo: '+2348010000000',
  numberOfUnits: 3,
  nightlyRentNaira: 25000,
};

test('A pending (unapproved) renter cannot create a listing', async () => {
  const { token } = await makePendingRenter();
  const res = await request(app)
    .post('/accommodations')
    .set('Authorization', `Bearer ${token}`)
    .send(validPayload);
  assert.equal(res.status, 403);
});

test('An approved renter can create, read, update and deactivate a listing', async () => {
  const { token } = await makeApprovedRenter();

  const create = await request(app)
    .post('/accommodations')
    .set('Authorization', `Bearer ${token}`)
    .send({ ...validPayload, amenities: ['Wi-Fi', 'Air Conditioning'], images: ['https://example.com/a.jpg'] });
  assert.equal(create.status, 201);
  assert.equal(create.body.state, 'Lagos');
  assert.equal(create.body.area, 'Lekki');
  assert.equal(Number(create.body.nightly_rent_naira), 25000);
  assert.equal(create.body.units_available, 3);
  assert.equal(create.body.amenities.length, 2);
  assert.equal(create.body.images.length, 1);

  const id = create.body.id;

  // Public view hides contact_info.
  const publicView = await request(app).get(`/accommodations/${id}`);
  assert.equal(publicView.status, 200);
  assert.equal(publicView.body.contact_info, undefined);

  // Owner view includes it.
  const ownerView = await request(app)
    .get(`/accommodations/mine/${id}`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(ownerView.status, 200);
  assert.equal(ownerView.body.contact_info, validPayload.contactInfo);

  // Update nightly rent.
  const update = await request(app)
    .patch(`/accommodations/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ nightlyRentNaira: 28000 });
  assert.equal(update.status, 200);
  assert.equal(Number(update.body.nightly_rent_naira), 28000);

  // Deactivate.
  const deactivate = await request(app)
    .post(`/accommodations/${id}/deactivate`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(deactivate.status, 200);
  assert.equal(deactivate.body.is_active, false);

  // No longer visible publicly.
  const afterDeactivate = await request(app).get(`/accommodations/${id}`);
  assert.equal(afterDeactivate.status, 404);
});

test('Creating a listing above the Price Cap for its location is rejected with the exact spec message', async () => {
  const { token } = await makeApprovedRenter();
  const res = await request(app)
    .post('/accommodations')
    .set('Authorization', `Bearer ${token}`)
    .send({ ...validPayload, nightlyRentNaira: 40000 }); // Lekki cap is 30,000
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'You have exceeded the Price Cap for this location.');
});

test('Posting in an unsupported Lagos area (not one of the 11 named areas) is rejected', async () => {
  const { token } = await makeApprovedRenter();
  const res = await request(app)
    .post('/accommodations')
    .set('Authorization', `Bearer ${token}`)
    .send({ ...validPayload, area: 'Ikorodu' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /not a supported area/);
});

test('One renter cannot read another renter\'s listing via the owner-only endpoint, or edit it', async () => {
  const owner = await makeApprovedRenter('owner@example.com');
  const intruder = await makeApprovedRenter('intruder@example.com');

  const create = await request(app)
    .post('/accommodations')
    .set('Authorization', `Bearer ${owner.token}`)
    .send(validPayload);
  const id = create.body.id;

  const readAttempt = await request(app)
    .get(`/accommodations/mine/${id}`)
    .set('Authorization', `Bearer ${intruder.token}`);
  assert.equal(readAttempt.status, 404);

  const editAttempt = await request(app)
    .patch(`/accommodations/${id}`)
    .set('Authorization', `Bearer ${intruder.token}`)
    .send({ nightlyRentNaira: 1000 });
  assert.equal(editAttempt.status, 404);
});

test('Viewing availability: dates within 30 days can be marked and unmarked; outside the window is rejected', async () => {
  const { token } = await makeApprovedRenter();
  const create = await request(app)
    .post('/accommodations')
    .set('Authorization', `Bearer ${token}`)
    .send(validPayload);
  const id = create.body.id;

  const inTenDays = new Date();
  inTenDays.setUTCDate(inTenDays.getUTCDate() + 10);
  const validDate = inTenDays.toISOString().slice(0, 10);

  const farOut = new Date();
  farOut.setUTCDate(farOut.getUTCDate() + 60);
  const invalidDate = farOut.toISOString().slice(0, 10);

  const markValid = await request(app)
    .post(`/accommodations/${id}/viewing-availability`)
    .set('Authorization', `Bearer ${token}`)
    .send({ dates: [validDate] });
  assert.equal(markValid.status, 201);
  assert.equal(markValid.body.viewingAvailability.length, 1);

  const markInvalid = await request(app)
    .post(`/accommodations/${id}/viewing-availability`)
    .set('Authorization', `Bearer ${token}`)
    .send({ dates: [invalidDate] });
  assert.equal(markInvalid.status, 400);

  const unmark = await request(app)
    .delete(`/accommodations/${id}/viewing-availability/${validDate}`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(unmark.status, 200);
  assert.equal(unmark.body.viewingAvailability.length, 0);
});

test('Amenities endpoint rejects unknown amenity names', async () => {
  const { token } = await makeApprovedRenter();
  const create = await request(app)
    .post('/accommodations')
    .set('Authorization', `Bearer ${token}`)
    .send(validPayload);
  const id = create.body.id;

  const res = await request(app)
    .put(`/accommodations/${id}/amenities`)
    .set('Authorization', `Bearer ${token}`)
    .send({ amenities: ['Wi-Fi', 'Jacuzzi Helicopter Pad'] });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Unknown amenities/);
});

test('GET /accommodations/price-caps and /accommodations/amenities are public and return seeded data', async () => {
  const priceCaps = await request(app).get('/accommodations/price-caps');
  assert.equal(priceCaps.status, 200);
  assert.equal(priceCaps.body.length, 22);

  const amenities = await request(app).get('/accommodations/amenities');
  assert.equal(amenities.status, 200);
  assert.ok(amenities.body.length >= 10);
});
