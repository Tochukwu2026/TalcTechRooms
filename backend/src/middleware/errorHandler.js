const ApiError = require('../utils/ApiError');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      error: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  // Postgres unique-violation / check-violation / raised exceptions surface useful messages
  // (e.g. the Price Cap trigger's RAISE EXCEPTION text) - pass those through as 400s rather
  // than a generic 500, since they're caused by the request, not a server bug.
  if (err && err.code && typeof err.code === 'string' && err.code.startsWith('23')) {
    return res.status(400).json({ error: err.message });
  }
  if (err && err.code === 'P0001') {
    // raise_exception from a trigger, e.g. the Price Cap check
    return res.status(400).json({ error: err.message });
  }

  // eslint-disable-next-line no-console
  console.error(err);
  return res.status(500).json({ error: 'Internal server error.' });
}

module.exports = errorHandler;
