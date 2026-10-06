DROP INDEX IF EXISTS uniq_exec_sub_charge_reference;
ALTER TABLE executive_subscriptions DROP COLUMN IF EXISTS paystack_charge_reference;
