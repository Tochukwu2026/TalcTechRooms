-- Bookings track Rent, Admin Costs and VAT as separate line items (they're taxed/split/paid
-- out differently - see Customer Checkout Cost Breakdown), plus the two-path Renter payout
-- state machine (Path A: held until 9pm WAT on check-in day; Path B: instant on a confirmed
-- no-refund cancellation).

CREATE TYPE booking_status AS ENUM (
  'active',
  'checked_in_confirmed',
  'fraud_reported',
  'canceled_refundable',
  'canceled_no_refund',
  'completed'
);

CREATE TYPE payout_status AS ENUM (
  'held',           -- Path A: waiting for check-in day 9pm WAT evaluation
  'released',       -- paid out to Renter (either path)
  'admin_review',   -- Path A: neither confirmed nor reported by 9pm - flagged
  'not_applicable'  -- e.g. fraud confirmed, no payout ever happens
);

CREATE TABLE bookings (
  id BIGSERIAL PRIMARY KEY,
  accommodation_id BIGINT NOT NULL REFERENCES accommodations (id),
  customer_user_id BIGINT NOT NULL REFERENCES customers (user_id),
  check_in_date DATE NOT NULL,
  check_out_date DATE NOT NULL,
  units_booked INTEGER NOT NULL CHECK (units_booked > 0),

  -- Line items - see Customer Checkout Cost Breakdown in spec/decisions-and-phasing.md
  rent_naira NUMERIC(10, 2) NOT NULL,
  admin_costs_naira NUMERIC(10, 2) NOT NULL,
  vat_naira NUMERIC(10, 2) NOT NULL,
  total_charged_naira NUMERIC(10, 2) NOT NULL,

  -- Renter/TalcTech split (85/15 of rent_naira only - VAT/Admin Costs never enter this math)
  commission_naira NUMERIC(10, 2) NOT NULL,
  renter_gross_payout_naira NUMERIC(10, 2) NOT NULL, -- 85% of rent, before the Paystack fee
  paystack_fee_naira NUMERIC(10, 2) NOT NULL DEFAULT 0,
  renter_net_payout_naira NUMERIC(10, 2) NOT NULL, -- what actually gets transferred

  status booking_status NOT NULL DEFAULT 'active',
  payout_status payout_status NOT NULL DEFAULT 'held',
  payout_released_at TIMESTAMPTZ,

  paystack_charge_reference TEXT,
  paystack_transfer_reference TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (check_out_date > check_in_date)
);

CREATE INDEX idx_bookings_accommodation ON bookings (accommodation_id);
CREATE INDEX idx_bookings_customer ON bookings (customer_user_id);
CREATE INDEX idx_bookings_status ON bookings (status);
CREATE INDEX idx_bookings_checkin_payout ON bookings (check_in_date, payout_status)
  WHERE status = 'active';

-- Admin review queue for flagged/reported check-in-day bookings (Path A only - Path B never
-- enters this queue). Also used for the fraud-report workflow.
CREATE TYPE admin_case_reason AS ENUM ('no_show_no_response', 'fraud_report', 'other');
CREATE TYPE admin_case_status AS ENUM ('open', 'resolved');

CREATE TABLE admin_review_cases (
  id BIGSERIAL PRIMARY KEY,
  booking_id BIGINT NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  reason admin_case_reason NOT NULL,
  status admin_case_status NOT NULL DEFAULT 'open',
  notes TEXT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_by BIGINT REFERENCES users (id),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_admin_review_cases_status ON admin_review_cases (status);
CREATE INDEX idx_admin_review_cases_booking ON admin_review_cases (booking_id);

-- Refunds need a reason code (customer cancellation vs. fraud confirmed) - see
-- Cancellation/Refund in the decisions log.
CREATE TYPE refund_reason AS ENUM ('customer_cancellation', 'fraud_confirmed');

CREATE TABLE refunds (
  id BIGSERIAL PRIMARY KEY,
  booking_id BIGINT NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  amount_naira NUMERIC(10, 2) NOT NULL,
  reason refund_reason NOT NULL,
  paystack_refund_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_refunds_booking ON refunds (booking_id);
