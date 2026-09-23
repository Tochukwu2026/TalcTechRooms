-- Executive Customer monthly subscription (base ~N10,000 + Admin Costs + VAT, see
-- spec/decisions-and-phasing.md Customer Checkout Cost Breakdown). Kept separate from
-- customers so subscription history/cancel-resubscribe cycles don't mutate the customer row.

CREATE TYPE subscription_status AS ENUM ('active', 'canceled', 'past_due');

CREATE TABLE executive_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  customer_user_id BIGINT NOT NULL REFERENCES customers (user_id) ON DELETE CASCADE,
  status subscription_status NOT NULL DEFAULT 'active',
  base_fee_naira NUMERIC(10, 2) NOT NULL,
  admin_costs_naira NUMERIC(10, 2) NOT NULL,
  vat_naira NUMERIC(10, 2) NOT NULL,
  total_charged_naira NUMERIC(10, 2) NOT NULL,
  paystack_subscription_code TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_period_ends_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ
);

CREATE INDEX idx_exec_subs_customer ON executive_subscriptions (customer_user_id);

-- Admin-editable settings so commission %, VAT %, Admin fee, SMS cost, etc. can change
-- from the Admin dashboard without a rebuild (see Business Rules > Commission in the
-- decisions log). Single-row key/value table, values stored as text and parsed by the app.
CREATE TABLE admin_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
