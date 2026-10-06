-- Ties each Executive subscription row to the Paystack charge that paid for it, so finalizing an
-- upgrade is idempotent: the Paystack webhook and the app's own "verify" call can both land for
-- the same payment, and only the first one creates the subscription row / flips the tier.
-- Nullable because rows created before this migration (and any future non-charge path) have no
-- reference; the unique index only constrains rows that do.
ALTER TABLE executive_subscriptions ADD COLUMN paystack_charge_reference TEXT;

CREATE UNIQUE INDEX uniq_exec_sub_charge_reference
  ON executive_subscriptions (paystack_charge_reference)
  WHERE paystack_charge_reference IS NOT NULL;
