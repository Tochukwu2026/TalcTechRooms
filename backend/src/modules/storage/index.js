// Provider-agnostic storage interface, mirroring src/modules/idVerification's shape. Callers
// use these functions and never touch mockProvider/gcsProvider directly, so switching
// STORAGE_MODE in .env is the only thing needed to go from mock to real GCS - no call-site
// changes.
const config = require('../../config');
const mockProvider = require('./mockProvider');
const gcsProvider = require('./gcsProvider');

function provider() {
  return config.storage.mode === 'gcs' ? gcsProvider : mockProvider;
}

/** Builds a namespaced object path for a new upload under a given accommodation. */
function generateObjectPath(accommodationId, contentType) {
  return provider().generateObjectPath(accommodationId, contentType);
}

/** Returns a short-lived signed URL the client can PUT the file's bytes to directly. */
async function getUploadUrl(objectPath, contentType) {
  return provider().getUploadUrl(objectPath, contentType);
}

/** The URL an uploaded object will be publicly reachable at, once confirmed. */
function publicUrl(objectPath) {
  return provider().publicUrl(objectPath);
}

/** Checks whether an object actually exists in storage - see each provider's own caveats. */
async function confirmObjectExists(objectPath) {
  return provider().confirmObjectExists(objectPath);
}

/** Best-effort delete of the underlying object when an image is removed from a listing. */
async function deleteObject(objectPath) {
  return provider().deleteObject(objectPath);
}

const ALLOWED_IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

module.exports = {
  generateObjectPath,
  getUploadUrl,
  publicUrl,
  confirmObjectExists,
  deleteObject,
  ALLOWED_IMAGE_CONTENT_TYPES,
};
