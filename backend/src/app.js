const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const authRoutes = require('./routes/authRoutes');
const renterRoutes = require('./routes/renterRoutes');
const customerRoutes = require('./routes/customerRoutes');
const adminRoutes = require('./routes/adminRoutes');
const accommodationRoutes = require('./routes/accommodationRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const staffRoutes = require('./routes/staffRoutes');
const internalRoutes = require('./routes/internalRoutes');
const errorHandler = require('./middleware/errorHandler');

function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  // Stashes the raw request body bytes on req.rawBody, needed to verify Paystack's webhook
  // HMAC signature (webhookRoutes.js) - a re-serialized JSON object won't match the signature,
  // only the exact bytes Paystack sent.
  app.use(
    express.json({
      verify: (req, res, buf) => {
        req.rawBody = buf;
      },
    })
  );
  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('dev'));
  }

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/auth', authRoutes);
  app.use('/renters', renterRoutes);
  app.use('/customers', customerRoutes);
  app.use('/admin', adminRoutes);
  app.use('/accommodations', accommodationRoutes);
  app.use('/bookings', bookingRoutes);
  app.use('/webhooks', webhookRoutes);
  app.use('/staff', staffRoutes);
  app.use('/internal', internalRoutes);

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  app.use(errorHandler);

  return app;
}

module.exports = createApp;
