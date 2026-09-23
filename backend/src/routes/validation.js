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

module.exports = { renterRegisterSchema, customerRegisterSchema, loginSchema, validateBody };
