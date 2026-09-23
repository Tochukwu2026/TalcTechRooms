-- Executive Feature Viewing bookings (Phase 1). Type-specific limits (1 Video Viewing per
-- location per week; 1 Live Viewing per listing per month + 3 Live Viewings total per month)
-- are enforced in application code (src/modules/viewings), not here, since they need
-- "per calendar week/month across all of this customer's bookings" queries that are clearer
-- to express and unit-test in JS than as a single constraint/trigger.

CREATE TYPE viewing_type AS ENUM ('live', 'video');
CREATE TYPE viewing_status AS ENUM ('scheduled', 'completed', 'cancelled');

CREATE TABLE viewing_bookings (
  id BIGSERIAL PRIMARY KEY,
  customer_user_id BIGINT NOT NULL REFERENCES customers (user_id),
  accommodation_id BIGINT NOT NULL REFERENCES accommodations (id),
  viewing_type viewing_type NOT NULL,
  scheduled_date DATE NOT NULL,
  status viewing_status NOT NULL DEFAULT 'scheduled',
  assigned_staff_user_id BIGINT REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_viewing_bookings_customer ON viewing_bookings (customer_user_id);
CREATE INDEX idx_viewing_bookings_accommodation ON viewing_bookings (accommodation_id);
CREATE INDEX idx_viewing_bookings_type_date ON viewing_bookings (viewing_type, scheduled_date);

-- A Live Viewing date, once booked, is dead for all other Executive Customers. Enforced via
-- a partial unique index rather than only application logic, so a race between two
-- simultaneous requests can't double-book the same listing/date.
CREATE UNIQUE INDEX uniq_live_viewing_per_accommodation_date
  ON viewing_bookings (accommodation_id, scheduled_date)
  WHERE viewing_type = 'live' AND status != 'cancelled';

CREATE TYPE notification_channel AS ENUM ('email', 'sms');
CREATE TYPE notification_status AS ENUM ('queued', 'sent', 'failed');

CREATE TABLE notifications_log (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users (id),
  channel notification_channel NOT NULL,
  type TEXT NOT NULL, -- e.g. 'booking_confirmation', 'renter_approved', 'viewing_confirmation'
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status notification_status NOT NULL DEFAULT 'queued',
  cost_naira NUMERIC(10, 2) NOT NULL DEFAULT 0, -- Termii SMS cost, passed through per Admin Costs
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_log_user ON notifications_log (user_id);
