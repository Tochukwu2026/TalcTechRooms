const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const createApp = require('../../src/app');
const { pool } = require('../../src/db/pool');
const { runRenewals } = require('../../src/modules/customers/renewalService');
const { cleanDatabase, closeDatabase } = require('./testHelpers');

const app = createApp();

test.beforeEach(async () => {
  await cleanDatabase();
});

test.after(async () => {
  await cleanDatabase();
  await closeDatabase();
});

const PASSWORD = 'super-secret-1';

async function registerCustomer(overrides = {}) {
  const email = overrides.email || 'customer@example.com';
  const res = await request(app)
    .post('/customers/register')
    .send({
      email,
      phone: '08012345678',
      fullName: 'A Customer',
      password: PASSWORD,
      tier: 'regular',
      documentType: 'passport',
      documentNumber: 'B1234569', // does not end in 0 -> verified
      ...overrides,
    });
  assert.equal(res.status, 201);
  if (overrides.tier === 'executive') {
    // Registration never grants Executive by itself (it must be paid for) - promote directly for these tests.
    await pool.query("UPDATE customers SET tier = 'executive' WHERE user_id = (SELECT id FROM users WHERE email = $1)", [email]);
  }
  return login(email, overrides.password || PASSWORD);
}

async function login(email, password) {
  const res = await request(app).post('/auth/login').send({ email, password });
  assert.equal(res.status, 200);
  return { token: res.body.token, user: res.body.user };
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function tierOf(userId) {
  const { rows } = await pool.query('SELECT tier FROM customers WHERE user_id = $1', [userId]);
  return rows[0].tier;
}

async function subscriptionCount(userId) {
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM executive_subscriptions WHERE customer_user_id = $1',
    [userId]
  );
  return rows[0].n;
}

// ---------- Executive upgrade ----------

test('A Regular Customer can upgrade to Executive by paying; verifying twice does not double-charge or double-record', async () => {
  const { token, user } = await registerCustomer();

  const init = await request(app).post('/customers/me/executive-upgrade/initialize').set(auth(token));
  assert.equal(init.status, 201);
  assert.ok(init.body.reference.startsWith('subscription_'));
  assert.equal(init.body.totalChargedNaira, 10863.84); // 10,000 + 105.90 admin costs + 7.5% VAT
  assert.equal(await tierOf(user.id), 'regular', 'tier must not change before payment is confirmed');

  const verify = await request(app)
    .post(`/customers/me/executive-upgrade/verify/${init.body.reference}`)
    .set(auth(token));
  assert.equal(verify.status, 201);
  assert.equal(verify.body.status, 'upgraded');
  assert.equal(verify.body.tier, 'executive');
  assert.equal(verify.body.subscription.totalChargedNaira, 10863.84);
  assert.ok(verify.body.subscription.currentPeriodEndsAt);
  assert.equal(await tierOf(user.id), 'executive');

  const again = await request(app)
    .post(`/customers/me/executive-upgrade/verify/${init.body.reference}`)
    .set(auth(token));
  assert.equal(again.status, 200);
  assert.equal(again.body.status, 'already_finalized');
  assert.equal(await subscriptionCount(user.id), 1);

  const relogin = await login('customer@example.com', PASSWORD);
  assert.equal(relogin.user.tier, 'executive');
});

test('An Executive Customer cannot start another upgrade', async () => {
  const { token } = await registerCustomer({ tier: 'executive' });
  const init = await request(app).post('/customers/me/executive-upgrade/initialize').set(auth(token));
  assert.equal(init.status, 409);
});

test('A declined payment leaves the Customer Regular and records nothing', async () => {
  const { token, user } = await registerCustomer({ email: 'declined+fail@example.com' });

  const init = await request(app).post('/customers/me/executive-upgrade/initialize').set(auth(token));
  assert.equal(init.status, 201);

  const verify = await request(app)
    .post(`/customers/me/executive-upgrade/verify/${init.body.reference}`)
    .set(auth(token));
  assert.equal(verify.status, 402);
  assert.equal(verify.body.status, 'payment_failed');
  assert.equal(await tierOf(user.id), 'regular');
  assert.equal(await subscriptionCount(user.id), 0);
});

test('An unknown payment reference is a 404, and a Customer whose ID failed verification cannot upgrade', async () => {
  const { token } = await registerCustomer();
  const missing = await request(app)
    .post('/customers/me/executive-upgrade/verify/subscription_does_not_exist')
    .set(auth(token));
  assert.equal(missing.status, 404);

  const unverified = await registerCustomer({
    email: 'unverified@example.com',
    documentType: 'pvc',
    documentNumber: 'PVC00000', // ends in 0 -> mock provider fails verification
  });
  const init = await request(app).post('/customers/me/executive-upgrade/initialize').set(auth(unverified.token));
  assert.equal(init.status, 403);
});

test("Another Customer cannot read someone else's upgrade confirmation", async () => {
  const payer = await registerCustomer({ email: 'payer@example.com' });
  const other = await registerCustomer({ email: 'other@example.com' });

  const init = await request(app).post('/customers/me/executive-upgrade/initialize').set(auth(payer.token));
  const peek = await request(app)
    .post(`/customers/me/executive-upgrade/verify/${init.body.reference}`)
    .set(auth(other.token));
  assert.equal(peek.status, 403);
  assert.equal(await tierOf(other.user.id), 'regular', 'the other Customer must not be upgraded');
});

test('The Paystack webhook finalizes an upgrade charge (and a later verify call is a no-op)', async () => {
  const { token, user } = await registerCustomer();
  const init = await request(app).post('/customers/me/executive-upgrade/initialize').set(auth(token));

  const hook = await request(app)
    .post('/webhooks/paystack')
    .send({
      event: 'charge.success',
      data: { reference: init.body.reference, metadata: { kind: 'executive_subscription' } },
    });
  assert.equal(hook.status, 200);
  assert.equal(await tierOf(user.id), 'executive');

  const verify = await request(app)
    .post(`/customers/me/executive-upgrade/verify/${init.body.reference}`)
    .set(auth(token));
  assert.equal(verify.status, 200);
  assert.equal(verify.body.status, 'already_finalized');
  assert.equal(await subscriptionCount(user.id), 1);
});

test('Only Customers can use the upgrade and account endpoints', async () => {
  const anon = await request(app).post('/customers/me/executive-upgrade/initialize');
  assert.equal(anon.status, 401);
  const anonProfile = await request(app).get('/customers/me');
  assert.equal(anonProfile.status, 401);

  // A Renter's token must not reach Customer account endpoints.
  const renterReg = await request(app).post('/renters/register').send({
    email: 'renter@example.com',
    fullName: 'A Renter',
    password: PASSWORD,
    address: '1 Test Street, Lagos',
    documentType: 'passport',
    documentNumber: 'R1234569',
  });
  assert.equal(renterReg.status, 201);
  const renter = await login('renter@example.com', PASSWORD);
  const res = await request(app).get('/customers/me').set(auth(renter.token));
  assert.equal(res.status, 403);
});

// ---------- Account settings ----------

test('A Customer can view their account details', async () => {
  const { token, user } = await registerCustomer();
  const res = await request(app).get('/customers/me').set(auth(token));
  assert.equal(res.status, 200);
  assert.equal(res.body.email, 'customer@example.com');
  assert.equal(res.body.phone, '08012345678');
  assert.equal(res.body.fullName, 'A Customer');
  assert.equal(res.body.tier, 'regular');
  assert.equal(String(res.body.id), String(user.id));
  assert.equal(res.body.executivePeriodEndsAt, null);
  assert.equal(res.body.password_hash, undefined);
});

test('Phone can be changed without a password; an empty phone clears it; a short one is rejected', async () => {
  const { token } = await registerCustomer();

  const changed = await request(app).patch('/customers/me').set(auth(token)).send({ phone: '09087654321' });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.phone, '09087654321');

  const cleared = await request(app).patch('/customers/me').set(auth(token)).send({ phone: '' });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.phone, null);

  const bad = await request(app).patch('/customers/me').set(auth(token)).send({ phone: '123' });
  assert.equal(bad.status, 422); // request-body validation failures are 422 across this API
});

test('Changing email needs the current password, and the new email becomes the login', async () => {
  const { token } = await registerCustomer();

  const noPassword = await request(app).patch('/customers/me').set(auth(token)).send({ email: 'new@example.com' });
  assert.equal(noPassword.status, 400);

  const wrongPassword = await request(app)
    .patch('/customers/me')
    .set(auth(token))
    .send({ email: 'new@example.com', currentPassword: 'not-the-password' });
  assert.equal(wrongPassword.status, 403);

  const ok = await request(app)
    .patch('/customers/me')
    .set(auth(token))
    .send({ email: 'new@example.com', currentPassword: PASSWORD });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.email, 'new@example.com');

  await login('new@example.com', PASSWORD);
  const oldLogin = await request(app).post('/auth/login').send({ email: 'customer@example.com', password: PASSWORD });
  assert.equal(oldLogin.status, 401);

  // The token issued before the change keeps working, and now sees the new email.
  const stillWorks = await request(app).get('/customers/me').set(auth(token));
  assert.equal(stillWorks.status, 200);
  assert.equal(stillWorks.body.email, 'new@example.com');
});

test('An email already used by another account is refused', async () => {
  await registerCustomer({ email: 'taken@example.com' });
  const { token } = await registerCustomer({ email: 'me@example.com' });
  const res = await request(app)
    .patch('/customers/me')
    .set(auth(token))
    .send({ email: 'taken@example.com', currentPassword: PASSWORD });
  assert.equal(res.status, 409);
});

test('Full name cannot be changed through account settings', async () => {
  const { token } = await registerCustomer();
  const res = await request(app).patch('/customers/me').set(auth(token)).send({ fullName: 'Someone Else' });
  assert.equal(res.status, 200);
  assert.equal(res.body.fullName, 'A Customer');
});

test('Password change needs the right current password and a different, long-enough new one', async () => {
  const { token } = await registerCustomer();

  const wrong = await request(app)
    .post('/customers/me/password')
    .set(auth(token))
    .send({ currentPassword: 'nope-nope-1', newPassword: 'brand-new-pass-1' });
  assert.equal(wrong.status, 403);

  const same = await request(app)
    .post('/customers/me/password')
    .set(auth(token))
    .send({ currentPassword: PASSWORD, newPassword: PASSWORD });
  assert.equal(same.status, 400);

  const short = await request(app)
    .post('/customers/me/password')
    .set(auth(token))
    .send({ currentPassword: PASSWORD, newPassword: 'short' });
  assert.equal(short.status, 422);

  const ok = await request(app)
    .post('/customers/me/password')
    .set(auth(token))
    .send({ currentPassword: PASSWORD, newPassword: 'brand-new-pass-1' });
  assert.equal(ok.status, 200);

  await login('customer@example.com', 'brand-new-pass-1');
  const old = await request(app).post('/auth/login').send({ email: 'customer@example.com', password: PASSWORD });
  assert.equal(old.status, 401);
});

// ---------- Executive sign-up (payment required) ----------

test('Signing up as Executive creates a Regular account and asks for payment; paying makes them Executive and saves the card', async () => {
  const { token, user } = await registerCustomer({ email: 'newexec@example.com', tier: 'executive' });
  // registerCustomer() above promotes executive requests directly for other tests - undo that to
  // exercise the real flow, then check the registration response itself separately below.
  await pool.query("UPDATE customers SET tier = 'regular' WHERE user_id = $1", [user.id]);

  const reg = await request(app).post('/customers/register').send({
    email: 'signup-exec@example.com',
    phone: '08011112222',
    fullName: 'Sign Up Exec',
    password: PASSWORD,
    tier: 'executive',
    documentType: 'passport',
    documentNumber: 'B1234569',
  });
  assert.equal(reg.status, 201);
  assert.equal(reg.body.tier, 'regular', 'must not be Executive until the payment is confirmed');
  assert.equal(reg.body.executivePaymentRequired, true);
  const plain = await request(app).post('/customers/register').send({
    email: 'signup-regular@example.com',
    fullName: 'Plain Regular',
    password: PASSWORD,
    documentType: 'passport',
    documentNumber: 'B1234569',
  });
  assert.equal(plain.body.executivePaymentRequired, false);

  const session = await login('signup-exec@example.com', PASSWORD);
  assert.equal(session.user.tier, 'regular');

  const init = await request(app).post('/customers/me/executive-upgrade/initialize').set(auth(session.token));
  assert.equal(init.status, 201);
  const verify = await request(app)
    .post(`/customers/me/executive-upgrade/verify/${init.body.reference}`)
    .set(auth(session.token));
  assert.equal(verify.status, 201);
  assert.equal(verify.body.tier, 'executive');
  assert.equal(verify.body.subscription.autoRenew, true);
  assert.deepEqual(verify.body.subscription.card, { brand: 'visa', last4: '4081' });

  const { rows } = await pool.query(
    'SELECT paystack_authorization_code, card_reusable FROM executive_subscriptions WHERE customer_user_id = $1',
    [session.user.id]
  );
  assert.ok(rows[0].paystack_authorization_code.startsWith('AUTH_'));
  assert.equal(rows[0].card_reusable, true);
  void token;
});

test('Abandoning the sign-up payment leaves a working Regular account', async () => {
  await request(app).post('/customers/register').send({
    email: 'abandon+fail@example.com',
    fullName: 'Abandoner',
    password: PASSWORD,
    tier: 'executive',
    documentType: 'passport',
    documentNumber: 'B1234569',
  });
  const session = await login('abandon+fail@example.com', PASSWORD);
  const init = await request(app).post('/customers/me/executive-upgrade/initialize').set(auth(session.token));
  const verify = await request(app)
    .post(`/customers/me/executive-upgrade/verify/${init.body.reference}`)
    .set(auth(session.token));
  assert.equal(verify.status, 402);
  assert.equal(await tierOf(session.user.id), 'regular');
});

// ---------- Monthly auto-renewal ----------

async function signUpAndPayExecutive(email) {
  const reg = await request(app).post('/customers/register').send({
    email,
    fullName: 'Renewing Exec',
    password: PASSWORD,
    tier: 'executive',
    documentType: 'passport',
    documentNumber: 'B1234569',
  });
  assert.equal(reg.status, 201);
  const session = await login(email, PASSWORD);
  const init = await request(app).post('/customers/me/executive-upgrade/initialize').set(auth(session.token));
  const verify = await request(app)
    .post(`/customers/me/executive-upgrade/verify/${init.body.reference}`)
    .set(auth(session.token));
  assert.equal(verify.status, 201);
  return session;
}

const inDays = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

async function subs(userId) {
  const { rows } = await pool.query(
    'SELECT status, auto_renew, current_period_ends_at, paystack_charge_reference FROM executive_subscriptions WHERE customer_user_id = $1 ORDER BY id',
    [userId]
  );
  return rows;
}

test('A paid month renews automatically on the saved card, once, and the next month starts where the last ended', async () => {
  const { user } = await signUpAndPayExecutive('renew@example.com');

  const early = await runRenewals({ now: inDays(10) });
  assert.equal(early.checked, 0, 'nothing is due yet');

  const first = await runRenewals({ now: inDays(32) });
  assert.equal(first.renewed, 1);
  const again = await runRenewals({ now: inDays(32) });
  assert.equal(again.checked, 0, 'a second run must not charge the same month twice');

  const rows = await subs(user.id);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, 'expired');
  assert.equal(rows[1].status, 'active');
  assert.ok(new Date(rows[1].current_period_ends_at) > new Date(rows[0].current_period_ends_at));
  assert.equal(await tierOf(user.id), 'executive');
});

test('Switching auto-renewal off keeps Executive until the paid month ends, then drops to Regular without charging', async () => {
  const { token, user } = await signUpAndPayExecutive('stop@example.com');

  const off = await request(app).patch('/customers/me/subscription').set(auth(token)).send({ autoRenew: false });
  assert.equal(off.status, 200);
  assert.equal(off.body.autoRenew, false);
  assert.equal(off.body.tier, 'executive');

  const midMonth = await runRenewals({ now: inDays(10) });
  assert.equal(midMonth.checked, 0);
  assert.equal(await tierOf(user.id), 'executive');

  const afterMonth = await runRenewals({ now: inDays(32) });
  assert.equal(afterMonth.downgraded, 1);
  assert.equal(await tierOf(user.id), 'regular');
  assert.equal((await subs(user.id)).length, 1, 'no new charge was made');

  const back = await request(app).patch('/customers/me/subscription').set(auth(token)).send({ autoRenew: true });
  assert.equal(back.status, 409, 'no active subscription left to switch on');
});

test('A declined renewal drops the Customer to Regular', async () => {
  const { user } = await signUpAndPayExecutive('late+renewfail@example.com');
  const run = await runRenewals({ now: inDays(32) });
  assert.equal(run.declined, 1);
  assert.equal(await tierOf(user.id), 'regular');
});

test('The auto-renewal switch is for Executive Customers and shows in their profile', async () => {
  const regular = await registerCustomer({ email: 'free@example.com' });
  const res = await request(app).patch('/customers/me/subscription').set(auth(regular.token)).send({ autoRenew: false });
  assert.equal(res.status, 409);

  const { token } = await signUpAndPayExecutive('profile@example.com');
  const me = await request(app).get('/customers/me').set(auth(token));
  assert.equal(me.body.autoRenew, true);
  assert.deepEqual(me.body.card, { brand: 'visa', last4: '4081' });
  assert.ok(me.body.executivePeriodEndsAt);

  const bad = await request(app).patch('/customers/me/subscription').set(auth(token)).send({ autoRenew: 'no' });
  assert.equal(bad.status, 422);
});
