#!/usr/bin/env node
// Standalone entry point for the Executive subscription renewal run - same two ways to run it as
// jobs/evaluateCheckInDayPayouts.js: this CLI (`npm run renew-subscriptions`) or the scheduler-
// guarded `POST /internal/renew-subscriptions`. Both call runRenewals(), which is safe to repeat.
const { runRenewals } = require('../modules/customers/renewalService');

module.exports = { renewExecutiveSubscriptions: runRenewals };

if (require.main === module) {
  runRenewals()
    .then((result) => {
      console.log(JSON.stringify(result));
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
