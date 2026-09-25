// Paystack webhook - the real-world primary trigger for finalizing a booking (see
// bookingService.finalizeBooking's header comment). Public/unauthenticated by necessity
// (Paystack's servers call this, not a logged-in Customer), so the signature check below is
// what stands in for authentication - see payments.verifyWebhookSignature (a no-op that always
// passes in mock mode, since there's no real webhook secret to check against yet).

const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const payments = require('../modules/payments');
const bookingService = require('../modules/booking/bookingService');

const router = Router();

router.post(
  '/paystack',
  asyncHandler(async (req, res) => {
    const signature = req.headers['x-paystack-signature'];
    const valid = payments.verifyWebhookSignature(req.rawBody, signature);
    if (!valid) {
      // Deliberately vague and a 401, not 4xx-with-details - this endpoint is public, so it
      // shouldn't hint at why a signature failed to a caller that isn't really Paystack.
      return res.status(401).json({ error: 'Invalid signature.' });
    }

    const event = req.body;
    // Paystack sends many event types (charge.success, transfer.success, etc.) - only
    // charge.success is relevant to booking creation; everything else is acknowledged and
    // ignored so Paystack doesn't keep retrying delivery.
    if (event?.event === 'charge.success' && event.data?.reference) {
      await bookingService.finalizeBooking(event.data.reference);
    }

    // Paystack expects a fast 200 regardless of what finalizeBooking decided (payment_failed/
    // availability_conflict aren't errors from Paystack's point of view - the charge itself
    // still succeeded) - respond promptly so Paystack doesn't retry.
    res.status(200).json({ received: true });
  })
);

module.exports = router;
