-- Record that a Customer saw and accepted the "Executive viewings not available in these states"
-- notice before paying for Executive (legal record). One row per time they accepted.
CREATE TABLE viewing_restriction_acknowledgements (
  id BIGSERIAL PRIMARY KEY,
  customer_user_id BIGINT NOT NULL REFERENCES customers (user_id),
  restricted_states TEXT[] NOT NULL,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_viewing_restriction_acks_customer ON viewing_restriction_acknowledgements (customer_user_id);
