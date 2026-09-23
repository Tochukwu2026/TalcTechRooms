require('dotenv').config();

function required(name, fallback) {
  const val = process.env[name] ?? fallback;
  return val;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),

  db: {
    connectionString: required('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/talctech_rooms'),
  },

  jwt: {
    secret: required('JWT_SECRET', 'dev-only-insecure-secret-change-me'),
    expiresIn: required('JWT_EXPIRES_IN', '7d'),
  },

  idVerification: {
    // 'mock' returns deterministic fake results so the rest of the app can be built/tested
    // before real Prembly credentials exist. Switch to 'prembly' once PREMBLY_APP_ID /
    // PREMBLY_API_KEY are set - see src/modules/idVerification/premblyProvider.js.
    mode: required('PREMBLY_MODE', 'mock'),
    prembly: {
      appId: process.env.PREMBLY_APP_ID || '',
      apiKey: process.env.PREMBLY_API_KEY || '',
      baseUrl: required('PREMBLY_BASE_URL', 'https://api.prembly.com'),
    },
  },

  // Business rules from spec/decisions-and-phasing.md - kept here as defaults/fallbacks only.
  // The authoritative values live in the admin_settings / price_caps DB tables so Admin can
  // change them without a redeploy; these constants are used only for seeding those tables.
  business: {
    commissionPercent: 15,
    vatPercent: 7.5,
    adminFeeNaira: 100,
    smsCostNaira: 5.9,
    executiveSubscriptionNaira: 10000,
  },
};

module.exports = config;
