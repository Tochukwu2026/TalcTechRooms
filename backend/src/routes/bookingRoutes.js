const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, requireRole } = require('../middleware/auth');
const ApiError = require('../utils/ApiError');
const bookingService = require('../modules/booking/bookingService');
const payoutService = require('../modules/payout/payoutService');
const { reportProblemSchema, validateBody } = require('./validation');

const router = Router();

router.use(authenticate, requireRole('customer'));

// Customer-triggered fallback for confirming a payment - the real-world primary trigger is
// Paystack's own webhook (see webhookRoutes.js), but there's no mobile app / hosted checkout
// return-page built yet to receive that redirect, so the app calls this directly after
// initiating a charge. Safe to call more than once - see bookingService.finalizeBooking.
router.post(
  '/verify/:reference',
  asyncHandler(async (req, res) => {
    const result = await bookingService.finalizeBooking(req.params.reference);

    if (result.status === 'not_found') {
      throw new ApiError(404, 'No charge was found for this reference.');
    }
    if (result.status === 'payment_failed') {
      return res.status(402).json({ status: 'payment_failed' });
    }
    if (result.status === 'availability_conflict') {
      return res.status(409).json({
        status: 'availability_conflict',
        message:
          'Payment succeeded but these units are no longer available. Contact support for a refund - ' +
          'automatic refunds for this case are not built yet.',
      });
    }

    // 'created' or 'already_finalized' - only let the Customer who paid see their own booking.
    if (String(result.booking.customerUserId) !== String(req.user.id)) {
      throw new ApiError(403, 'You do not have permission to view this booking.');
    }

    res.status(result.status === 'created' ? 201 : 200).json(result.booking);
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const booking = await bookingService.getBookingForCustomer(Number(req.params.id), req.user.id);
    res.json(booking);
  })
);

// Renter payout, Path A - see spec/decisions-and-phasing.md > Renter Payout. Both actions are
// only available on the Customer's own active booking (payoutService enforces ownership).
router.post(
  '/:id/confirm-check-in',
  asyncHandler(async (req, res) => {
    const result = await payoutService.confirmCheckIn(Number(req.params.id), req.user.id);
    res.json(result);
  })
);

router.post(
  '/:id/report-problem',
  validateBody(reportProblemSchema),
  asyncHandler(async (req, res) => {
    const result = await payoutService.reportProblem(Number(req.params.id), req.user.id, req.body.notes);
    res.status(201).json(result);
  })
);

// Renter payout, Path B - instant release on a confirmed no-refund cancellation (or a Rent-only
// refund if still within the >=7-day window) - see spec/decisions-and-phasing.md >
// Cancellation/Refund and Renter Payout.
router.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const result = await payoutService.cancelBooking(Number(req.params.id), req.user.id);
    res.json(result);
  })
);

module.exports = router;
