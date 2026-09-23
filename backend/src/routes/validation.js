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
  images: z.array(z.string().url()).max(30).optional(),
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

const imagesSchema = z.object({
  images: z.array(z.string().url()).min(1).max(30),
});

const viewingAvailabilitySchema = z.object({
  dates: z.array(isoDate).min(1).max(30),
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

module.exports = {
  renterRegisterSchema,
  customerRegisterSchema,
  loginSchema,
  createAccommodationSchema,
  updateAccommodationSchema,
  amenitiesSchema,
  imagesSchema,
  viewingAvailabilitySchema,
  validateBody,
};
