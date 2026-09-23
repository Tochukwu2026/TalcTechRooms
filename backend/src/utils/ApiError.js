// A typed error carrying an HTTP status code, so route handlers can `throw new ApiError(...)`
// and the central error middleware (src/middleware/errorHandler.js) renders it consistently.
class ApiError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

module.exports = ApiError;
