-- A paid month that has ended (renewed into a new row, or lapsed). 'active' stays "the current
-- paid period"; 'canceled'/'past_due' are kept as they were.
ALTER TYPE subscription_status ADD VALUE IF NOT EXISTS 'expired';
