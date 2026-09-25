const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, requireRole } = require('../middleware/auth');
const {
  createAccommodationSchema,
  updateAccommodationSchema,
  amenitiesSchema,
  requestImageUploadUrlSchema,
  confirmImageSchema,
  viewingAvailabilitySchema,
  searchQuerySchema,
  availabilityQuerySchema,
  checkoutPreviewQuerySchema,
  initializeBookingSchema,
  bookViewingSchema,
  validateBody,
  validateQuery,
} = require('./validation');
const accommodationService = require('../modules/accommodations/accommodationService');
const checkoutService = require('../modules/checkout/checkoutService');
const bookingService = require('../modules/booking/bookingService');
const viewingService = require('../modules/viewings/viewingService');

const router = Router();

// --- Public lookups (needed to build the location/amenities picklists in the app) ---

router.get(
  '/price-caps',
  asyncHandler(async (req, res) => {
    res.json(await accommodationService.listPriceCaps());
  })
);

router.get(
  '/amenities',
  asyncHandler(async (req, res) => {
    res.json(await accommodationService.listAmenities());
  })
);

// --- Public search (Main Homepage search bar) - registered before "/:id" so "/search" isn't
// swallowed by the "/:id" param route. ---

router.get(
  '/search',
  validateQuery(searchQuerySchema),
  asyncHandler(async (req, res) => {
    const results = await accommodationService.searchAccommodations(req.query);
    res.json(results);
  })
);

// --- Public read of a single listing (contact info withheld - see service for why) ---

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const accommodation = await accommodationService.getAccommodationPublic(Number(req.params.id));
    res.json(accommodation);
  })
);

// --- Public per-listing availability check (Bookings Homepage "Units" tab) ---

router.get(
  '/:id/availability',
  validateQuery(availabilityQuerySchema),
  asyncHandler(async (req, res) => {
    const result = await accommodationService.getAccommodationAvailability(
      Number(req.params.id),
      req.query.checkIn,
      req.query.checkOut
    );
    res.json(result);
  })
);

// --- Public checkout preview (Total Price + nightly breakdown, before Confirm Booking) ---

router.get(
  '/:id/checkout-preview',
  validateQuery(checkoutPreviewQuerySchema),
  asyncHandler(async (req, res) => {
    const units = req.query.units ?? 1;
    const result = await checkoutService.getBookingCheckoutPreview(
      Number(req.params.id),
      req.query.checkIn,
      req.query.checkOut,
      units
    );
    res.json(result);
  })
);

// --- Booking creation (Customer only) - starts a Paystack charge; does NOT create a booking
// row yet (a booking only exists once the charge is confirmed - see bookingRoutes.js /verify
// and webhookRoutes.js). ---

router.post(
  '/:id/bookings/initialize',
  authenticate,
  requireRole('customer'),
  validateBody(initializeBookingSchema),
  asyncHandler(async (req, res) => {
    const result = await bookingService.initializeBooking(
      req.user.id,
      req.user.email,
      Number(req.params.id),
      req.body
    );
    res.status(201).json(result);
  })
);

// --- Executive Feature Viewing bookings (Customer, Executive tier only - see viewingService
// for the 403 gate) ---

router.get(
  '/:id/viewings/video-availability',
  authenticate,
  requireRole('customer'),
  asyncHandler(async (req, res) => {
    res.json(await viewingService.getVideoAvailability(Number(req.params.id), req.user.id));
  })
);

router.get(
  '/:id/viewings/live-availability',
  authenticate,
  requireRole('customer'),
  asyncHandler(async (req, res) => {
    res.json(await viewingService.getLiveAvailability(Number(req.params.id), req.user.id));
  })
);

router.post(
  '/:id/viewings',
  authenticate,
  requireRole('customer'),
  validateBody(bookViewingSchema),
  asyncHandler(async (req, res) => {
    const result = await viewingService.bookViewing(req.user.id, Number(req.params.id), req.body);
    res.status(201).json(result);
  })
);

// --- Renter-owned CRUD, everything below requires an approved Renter ---

router.use(authenticate, requireRole('renter'));

router.post(
  '/',
  validateBody(createAccommodationSchema),
  asyncHandler(async (req, res) => {
    const accommodation = await accommodationService.createAccommodation(req.user.id, req.body);
    res.status(201).json(accommodation);
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await accommodationService.listOwnAccommodations(req.user.id));
  })
);

router.get(
  '/mine/:id',
  asyncHandler(async (req, res) => {
    const accommodation = await accommodationService.getAccommodationForOwner(
      Number(req.params.id),
      req.user.id
    );
    res.json(accommodation);
  })
);

router.patch(
  '/:id',
  validateBody(updateAccommodationSchema),
  asyncHandler(async (req, res) => {
    const accommodation = await accommodationService.updateAccommodation(
      Number(req.params.id),
      req.user.id,
      req.body
    );
    res.json(accommodation);
  })
);

router.post(
  '/:id/deactivate',
  asyncHandler(async (req, res) => {
    const accommodation = await accommodationService.setActive(Number(req.params.id), req.user.id, false);
    res.json(accommodation);
  })
);

router.post(
  '/:id/reactivate',
  asyncHandler(async (req, res) => {
    const accommodation = await accommodationService.setActive(Number(req.params.id), req.user.id, true);
    res.json(accommodation);
  })
);

router.put(
  '/:id/amenities',
  validateBody(amenitiesSchema),
  asyncHandler(async (req, res) => {
    const accommodation = await accommodationService.replaceAmenities(
      Number(req.params.id),
      req.user.id,
      req.body.amenities
    );
    res.json(accommodation);
  })
);

// Two-step upload: 1) ask for a signed URL and PUT the file bytes directly to storage,
// 2) confirm the object exists so it gets attached to the listing.
router.post(
  '/:id/images/upload-url',
  validateBody(requestImageUploadUrlSchema),
  asyncHandler(async (req, res) => {
    const result = await accommodationService.requestImageUploadUrl(
      Number(req.params.id),
      req.user.id,
      req.body.contentType
    );
    res.status(201).json(result);
  })
);

router.post(
  '/:id/images',
  validateBody(confirmImageSchema),
  asyncHandler(async (req, res) => {
    const accommodation = await accommodationService.confirmAccommodationImage(
      Number(req.params.id),
      req.user.id,
      req.body.objectPath
    );
    res.status(201).json(accommodation);
  })
);

router.delete(
  '/:id/images/:imageId',
  asyncHandler(async (req, res) => {
    const accommodation = await accommodationService.removeAccommodationImage(
      Number(req.params.id),
      req.user.id,
      Number(req.params.imageId)
    );
    res.json(accommodation);
  })
);

router.post(
  '/:id/viewing-availability',
  validateBody(viewingAvailabilitySchema),
  asyncHandler(async (req, res) => {
    const accommodation = await accommodationService.setViewingAvailability(
      Number(req.params.id),
      req.user.id,
      req.body.dates
    );
    res.status(201).json(accommodation);
  })
);

router.delete(
  '/:id/viewing-availability/:date',
  asyncHandler(async (req, res) => {
    const accommodation = await accommodationService.removeViewingAvailability(
      Number(req.params.id),
      req.user.id,
      req.params.date
    );
    res.json(accommodation);
  })
);

module.exports = router;
