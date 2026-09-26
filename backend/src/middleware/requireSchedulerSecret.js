// Guards internal, non-Customer-facing endpoints meant to be called only by an external
// scheduler (GCP Cloud Scheduler, cron, etc.) - see routes/internalRoutes.js. Not JWT auth (no
// scheduler "user" account exists, and shouldn't need to) - a shared secret sent as a header,
// same shape as Paystack's webhook signature check in webhookRoutes.js, and a reasonable interim
// approach consistent with the rest of this codebase's provider-agnostic caveats. The more
// "GCP-native" alternative - having Cloud Run require an authenticated invocation and Cloud
// Scheduler's HTTP target sign the request with an OIDC token - needs no secret at all and is
// worth switching to once this is actually deployed on Cloud Run; see the README section this
// links to for the setup either way.
const crypto = require('crypto');
const config = require('../config');
const ApiError = require('../utils/ApiError');

function requireSchedulerSecret(req, res, next) {
  const { secret } = config.scheduler;
  const provided = req.headers['x-scheduler-secret'];

  // No secret configured at all -> the endpoint is closed, full stop. Never silently accept an
  // unauthenticated request just because SCHEDULER_SECRET hasn't been set in this environment.
  if (!secret) {
    return next(new ApiError(401, 'This endpoint is not configured - SCHEDULER_SECRET is unset.'));
  }
  if (typeof provided !== 'string') {
    return next(new ApiError(401, 'Missing X-Scheduler-Secret header.'));
  }

  // Constant-time comparison - this is a bearer-token-style secret, so a timing side-channel on
  // string equality is worth avoiding even though the stakes here (triggering a read/flag job,
  // not moving money) are lower than, say, a payment webhook signature.
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!valid) {
    return next(new ApiError(401, 'Invalid X-Scheduler-Secret header.'));
  }

  return next();
}

module.exports = requireSchedulerSecret;
