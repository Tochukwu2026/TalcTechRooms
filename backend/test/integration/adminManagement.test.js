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
  // price_caps and admin_settings are shared seed/reference data that no other test file
  // resets (TABLES_TO_CLEAN deliberately leaves them alone, since most tests only ever read
  // them). This file's tests deliberately mutate both, so it must put them back the way it
  // found them - otherwise a later test file run against this same (persistent, real) database
  // would see a leftover price cap or a changed commission rate and fail for a completely
  // unrelated reason.
  await pool.query(`DELETE FROM price_caps WHERE state = 'Lagos' AND area = 'Badagry'`);
  await pool.query(`UPDATE price_caps SET cap_naira = 30000 WHERE state = 'Lagos' AND area = 'Lekki'`);
  await pool.query(`UPDATE admin_settings SET value = '15' WHERE key = 'commission_percent'`);
  await cleanDatabase();
  await closeDatabase();
});

async function makeAdmin(email = 'admin@talctech.example') {
  const passwordHash = await hashPassword('admin-password-123');
  await pool.query(
    `INSERT INTO users (role, email, phone, password_hash, full_name)
     VALUES ('admin', $1, '08010000000', $2, 'Admin User')`,
    [email, passwordHash]
  );
  const login = await request(app).post('/auth/login').send({ email, password: 'admin-password-123' });
  return login.body.token;
}

test('Admin can list, create, and update price caps', async () => {
  const token = await makeAdmin();

  const listBefore = await request(app).get('/admin/price-caps').set('Authorization', `Bearer ${token}`);
  assert.equal(listBefore.status, 200);
  assert.equal(listBefore.body.length, 22); // seeded default

  const lekki = listBefore.body.find((p) => p.state === 'Lagos' && p.area === 'Lekki');
  const update = await request(app)
    .patch(`/admin/price-caps/${lekki.id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ capNaira: 32000 });
  assert.equal(update.status, 200);
  assert.equal(Number(update.body.cap_naira), 32000);

  const created = await request(app)
    .post('/admin/price-caps')
    .set('Authorization', `Bearer ${token}`)
    .send({ state: 'Lagos', area: 'Badagry', capNaira: 18000 });
  assert.equal(created.status, 201);
  assert.equal(created.body.state, 'Lagos');
  assert.equal(created.body.area, 'Badagry');

  const listAfter = await request(app).get('/admin/price-caps').set('Authorization', `Bearer ${token}`);
  assert.equal(listAfter.body.length, 23);

  // Re-posting the same location updates rather than duplicating.
  const recreated = await request(app)
    .post('/admin/price-caps')
    .set('Authorization', `Bearer ${token}`)
    .send({ state: 'Lagos', area: 'Badagry', capNaira: 19000 });
  assert.equal(recreated.status, 201);
  assert.equal(recreated.body.id, created.body.id);
  assert.equal(Number(recreated.body.cap_naira), 19000);

  const listFinal = await request(app).get('/admin/price-caps').set('Authorization', `Bearer ${token}`);
  assert.equal(listFinal.body.length, 23);
});

test('Updating an unknown price cap 404s', async () => {
  const token = await makeAdmin();
  const res = await request(app)
    .patch('/admin/price-caps/999999')
    .set('Authorization', `Bearer ${token}`)
    .send({ capNaira: 10000 });
  assert.equal(res.status, 404);
});

test('Admin can list and update business settings (commission/VAT/admin fee/SMS cost)', async () => {
  const token = await makeAdmin();

  const listBefore = await request(app).get('/admin/settings').set('Authorization', `Bearer ${token}`);
  assert.equal(listBefore.status, 200);
  assert.equal(listBefore.body.length, 5);
  const commissionBefore = listBefore.body.find((s) => s.key === 'commission_percent');
  assert.equal(Number(commissionBefore.value), 15);

  const update = await request(app)
    .patch('/admin/settings/commission_percent')
    .set('Authorization', `Bearer ${token}`)
    .send({ value: 12.5 });
  assert.equal(update.status, 200);
  assert.equal(update.body.value, '12.5');

  // The checkout preview immediately reflects the new rate (settings are read fresh, not cached).
  const checkoutRes = await request(app).get('/customers/executive-subscription-cost');
  assert.equal(checkoutRes.status, 200);
  // base fee/admin costs/VAT unaffected by commission - just confirming the read-fresh behavior
  // doesn't error; commissionPercent only matters for booking previews, not the subscription one.
  assert.ok(checkoutRes.body.totalChargedNaira > 0);
});

test('Updating an unknown setting key 404s, and a non-numeric value is rejected with 422', async () => {
  const token = await makeAdmin();

  const unknown = await request(app)
    .patch('/admin/settings/not_a_real_setting')
    .set('Authorization', `Bearer ${token}`)
    .send({ value: 5 });
  assert.equal(unknown.status, 404);

  const nonNumeric = await request(app)
    .patch('/admin/settings/commission_percent')
    .set('Authorization', `Bearer ${token}`)
    .send({ value: 'not-a-number' });
  assert.equal(nonNumeric.status, 422);
});

test('Non-admin cannot access price-cap or settings management endpoints', async () => {
  const passwordHash = await hashPassword('super-secret-1');
  const userResult = await pool.query(
    `INSERT INTO users (role, email, phone, password_hash, full_name)
     VALUES ('customer', 'c@example.com', '08030000000', $1, 'A Customer') RETURNING id`,
    [passwordHash]
  );
  await pool.query(`INSERT INTO customers (user_id, tier) VALUES ($1, 'regular')`, [userResult.rows[0].id]);
  const login = await request(app).post('/auth/login').send({ email: 'c@example.com', password: 'super-secret-1' });

  const priceCaps = await request(app)
    .get('/admin/price-caps')
    .set('Authorization', `Bearer ${login.body.token}`);
  assert.equal(priceCaps.status, 403);

  const settings = await request(app)
    .get('/admin/settings')
    .set('Authorization', `Bearer ${login.body.token}`);
  assert.equal(settings.status, 403);
});
