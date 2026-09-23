-- Renter: requires manual Admin approval on top of automatic ID verification.
-- Customer: instant/automatic access once ID validation passes (no manual review queue).
-- Executive Customer subscription is tracked separately in 0004 so its billing lifecycle
-- (auto-renew, cancel) doesn't crowd this table.

CREATE TYPE renter_approval_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE customer_tier AS ENUM ('regular', 'executive');

CREATE TABLE renters (
  user_id BIGINT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  approval_status renter_approval_status NOT NULL DEFAULT 'pending',
  approved_by BIGINT REFERENCES users (id),
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  -- Settlement details for the Paystack Transfer API payout (Path A / Path B - see
  -- spec/decisions-and-phasing.md, Renter Payout). Not a Paystack subaccount/split_code,
  -- since the instant-split feature is deliberately not used.
  bank_name TEXT,
  bank_account_number TEXT,
  bank_account_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_renters_approval_status ON renters (approval_status);

CREATE TABLE customers (
  user_id BIGINT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  tier customer_tier NOT NULL DEFAULT 'regular',
  gender TEXT, -- informational/display only in Checkout itinerary; never used to filter bookings
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
