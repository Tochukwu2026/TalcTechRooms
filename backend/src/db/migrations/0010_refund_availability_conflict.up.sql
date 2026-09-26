-- Automatic refund on an availability conflict at booking-finalize time (see
-- src/modules/booking/bookingService.js finalizeBooking): a Paystack charge can succeed but the
-- units be gone by the time finalizeBooking runs (a race between two Customers' initialize
-- calls), in which case NO bookings row is ever created - a booking only represents a real,
-- successfully reserved stay. refunds.booking_id must therefore become nullable to record this
-- refund at all, and we add paystack_charge_reference to identify which charge was refunded when
-- there's no booking row to link to.
ALTER TABLE refunds ALTER COLUMN booking_id DROP NOT NULL;
ALTER TABLE refunds ADD COLUMN paystack_charge_reference TEXT;

-- Distinct from 'customer_cancellation'/'fraud_confirmed' - this refund is triggered by the
-- system itself, not a Customer or Admin action, and (per the founder's explicit choice,
-- 2026-09-26) refunds the FULL amount charged (Rent + Admin Costs + VAT), unlike the Rent-only
-- refund scope that applies to an actual cancellation or fraud case - see the Refund scope note
-- in spec/decisions-and-phasing.md > Cancellation/Refund. Nothing was ever delivered here (no
-- booking was ever created), so there's no basis for TalcTech to keep any part of the charge.
ALTER TYPE refund_reason ADD VALUE 'availability_conflict';
