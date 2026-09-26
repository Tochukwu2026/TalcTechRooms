-- Removing an enum value requires recreating the type (Postgres has no DROP VALUE). This will
-- fail if any refunds row still uses 'availability_conflict' or has a NULL booking_id - correct
-- behavior, since that data would be incompatible with the pre-migration schema.
ALTER TYPE refund_reason RENAME TO refund_reason_old;
CREATE TYPE refund_reason AS ENUM ('customer_cancellation', 'fraud_confirmed');
ALTER TABLE refunds ALTER COLUMN reason TYPE refund_reason USING reason::text::refund_reason;
DROP TYPE refund_reason_old;

ALTER TABLE refunds DROP COLUMN paystack_charge_reference;
ALTER TABLE refunds ALTER COLUMN booking_id SET NOT NULL;
