-- Card "authorization" saved from the Executive subscription's first Paystack charge, so later
-- months can be charged to the same card without the Customer re-entering it. Only Paystack's
-- reusable token and the card's brand + last 4 digits are stored - never a card number.
ALTER TABLE executive_subscriptions ADD COLUMN paystack_authorization_code TEXT;
ALTER TABLE executive_subscriptions ADD COLUMN card_brand TEXT;
ALTER TABLE executive_subscriptions ADD COLUMN card_last4 TEXT;
ALTER TABLE executive_subscriptions ADD COLUMN card_reusable BOOLEAN;
ALTER TABLE executive_subscriptions ADD COLUMN auto_renew BOOLEAN NOT NULL DEFAULT true;
