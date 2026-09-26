// Internal, non-Customer-facing endpoints meant to be called only by an external scheduler
// (GCP Cloud Scheduler, cron, etc.), never by the mobile app or admin dashboard. Guarded by
// requireSchedulerSecret (a shared secret, not JWT auth - see that middleware's header comment
// for why) instead of the usual authenticate/requireRole pair used everywhere else.

const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const requireSchedulerSecret = require('../middleware/requireSchedulerSecret');
const { evaluateCheckInDayPayouts } = require('../jobs/evaluateCheckInDayPayouts');

const router = Router();

// POST /internal/evaluate-payouts - real scheduler wiring for the 9pm-WAT check-in-day payout
// evaluation (see jobs/evaluateCheckInDayPayouts.js). The job itself is idempotent (see that
// file's header comment), so this endpoint is safe to call more than once for the same day or to
// retry after a failure - there's no need for the caller (Cloud Scheduler) to dedupe.
router.post(
  '/evaluate-payouts',
  requireSchedulerSecret,
  asyncHandler(async (req, res) => {
    const result = await evaluateCheckInDayPayouts();
    res.json(result);
  })
);

module.exports = router;
