const { z } = require('zod');

const documentSchema = z.object({
  documentType: z.enum(['nin', 'passport', 'pvc']),
  documentNumber: z.string().min(4).max(50),
});

const renterRegisterSchema = z.object({
  email: z.string().email(),
  phone: z.string().min(7).max(20).optional(),
  fullName: z.string().min(2).max(200),
  password: z.string().min(8).max(200),
  address: z.string().min(5).max(500),
}).merge(documentSchema);

const customerRegisterSchema = z.object({
  email: z.string().email(),
  phone: z.string().min(7).max(20).optional(),
  fullName: z.string().min(2).max(200),
  password: z.string().min(8).max(200),
  gender: z.string().max(30).optional(),
  tier: z.enum(['regular', 'executive']).optional(),
}).merge(documentSchema);

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Matches the accommodation_type Postgres enum in src/db/migrations/0005_*.up.sql.
const ACCOMMODATION_TYPES = [
  'room',
  'studio',
  'one_bedroom_apartment',
  'bungalow',
  'multiple_rooms_apartment',
  'duplex_house',
  'beach_house',
];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected an ISO date, e.g. 2026-10-05');

const createAccommodationSchema = z.object({
  type: z.enum(ACCOMMODATION_TYPES),
  state: z.string().min(2).max(100),
  area: z.string().min(2).max(100).optional(), // required for Lagos, omitted elsewhere
  locationText: z.string().min(5).max(500),
  description: z.string().min(10).max(5000),
  contactInfo: z.string().min(5).max(300),
  numberOfUnits: z.number().int().positive().max(1000),
  nightlyRentNaira: z.number().positive().max(10000000),
  amenities: z.array(z.string().min(1).max(100)).max(50).optional(),
});

const updateAccommodationSchema = z.object({
  type: z.enum(ACCOMMODATION_TYPES).optional(),
  state: z.string().min(2).max(100).optional(),
  area: z.string().min(2).max(100).optional(),
  locationText: z.string().min(5).max(500).optional(),
  description: z.string().min(10).max(5000).optional(),
  contactInfo: z.string().min(5).max(300).optional(),
  numberOfUnits: z.number().int().positive().max(1000).optional(),
  nightlyRentNaira: z.number().positive().max(10000000).optional(),
});

const amenitiesSchema = z.object({
  amenities: z.array(z.string().min(1).max(100)).max(50),
});

// Keep in sync with storage.ALLOWED_IMAGE_CONTENT_TYPES (src/modules/storage/index.js).
const requestImageUploadUrlSchema = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
});

const confirmImageSchema = z.object({
  objectPath: z.string().min(1).max(500),
});

const viewingAvailabilitySchema = z.object({
  dates: z.array(isoDate).min(1).max(30),
});

// Query params arrive as strings, so numeric fields use z.coerce.
const searchQuerySchema = z
  .object({
    state: z.string().min(2).max(100).optional(),
    area: z.string().min(2).max(100).optional(),
    type: z.enum(ACCOMMODATION_TYPES).optional(),
    checkIn: isoDate.optional(),
    checkOut: isoDate.optional(),
    minPrice: z.coerce.number().positive().optional(),
    maxPrice: z.coerce.number().positive().optional(),
  })
  .refine((data) => Boolean(data.checkIn) === Boolean(data.checkOut), {
    message: 'checkIn and checkOut must be provided together.',
    path: ['checkIn'],
  })
  .refine((data) => !data.checkIn || !data.checkOut || data.checkOut > data.checkIn, {
    message: 'checkOut must be after checkIn.',
    path: ['checkOut'],
  })
  .refine((data) => data.minPrice === undefined || data.maxPrice === undefined || data.maxPrice >= data.minPrice, {
    message: 'maxPrice must be greater than or equal to minPrice.',
    path: ['maxPrice'],
  });

const availabilityQuerySchema = z
  .object({
    checkIn: isoDate,
    checkOut: isoDate,
  })
  .refine((data) => data.checkOut > data.checkIn, {
    message: 'checkOut must be after checkIn.',
    path: ['checkOut'],
  });

const checkoutPreviewQuerySchema = z
  .object({
    checkIn: isoDate,
    checkOut: isoDate,
    units: z.coerce.number().int().positive().max(1000).optional(),
  })
  .refine((data) => data.checkOut > data.checkIn, {
    message: 'checkOut must be after checkIn.',
    path: ['checkOut'],
  });

const initializeBookingSchema = z
  .object({
    checkIn: isoDate,
    checkOut: isoDate,
    units: z.coerce.number().int().positive().max(1000).optional().default(1),
  })
  .refine((data) => data.checkOut > data.checkIn, {
    message: 'checkOut must be after checkIn.',
    path: ['checkOut'],
  });

// See renters.bank_name/bank_account_number/bank_account_name in
// src/db/migrations/0003_renters_customers.up.sql. Free-text bank name for now - see the
// bank_code caveat in src/modules/payments/paystackProvider.js.
const bankDetailsSchema = z.object({
  bankName: z.string().min(2).max(200),
  bankAccountNumber: z.string().min(6).max(20),
  bankAccountName: z.string().min(2).max(200),
});

// A Customer filing a problem/fraud report on check-in day (Path A) - see Renter Payout in
// spec/decisions-and-phasing.md. `notes` is optional free text (e.g. "listing doesn't match
// photos") for the Admin reviewing the case.
const reportProblemSchema = z.object({
  notes: z.string().min(1).max(2000).optional(),
});

// Matches admin_case_status/the two ways an Admin can resolve a flagged booking - see
// admin_review_cases in src/db/migrations/0006_bookings.up.sql and the Renter Payout section of
// the decisions log ("Admin resolves manually... before releasing funds or processing a
// refund").
const resolveReviewCaseSchema = z.object({
  resolution: z.enum(['release_payout', 'refund_customer']),
  notes: z.string().min(1).max(2000).optional(),
});

const updatePriceCapSchema = z.object({
  capNaira: z.number().positive().max(10000000),
});

const createPriceCapSchema = z.object({
  state: z.string().min(2).max(100),
  area: z.string().min(2).max(100).optional(),
  capNaira: z.number().positive().max(10000000),
});

// All current admin_settings values are numeric (commission_percent, vat_percent,
// admin_fee_naira, sms_cost_naira, executive_subscription_naira) - see
// src/db/seeds/002_admin_settings.sql. If a non-numeric setting is ever added, this will need
// to stop being a blanket numeric check.
const updateSettingSchema = z
  .object({
    value: z.union([z.string(), z.number()]).transform((v) => String(v)),
  })
  .refine((data) => !Number.isNaN(Number(data.value)) && data.value.trim() !== '', {
    message: 'value must be numeric - all current admin settings are numeric.',
    path: ['value'],
  });

function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(422).json({
        error: 'Validation failed.',
        details: result.error.flatten(),
      });
    }
    req.body = result.data;
    return next();
  };
}

function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(422).json({
        error: 'Validation failed.',
        details: result.error.flatten(),
      });
    }
    req.query = result.data;
    return next();
  };
}

module.exports = {
  renterRegisterSchema,
  customerRegisterSchema,
  loginSchema,
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
  bankDetailsSchema,
  reportProblemSchema,
  resolveReviewCaseSchema,
  updatePriceCapSchema,
  createPriceCapSchema,
  updateSettingSchema,
  validateBody,
  validateQuery,
};
