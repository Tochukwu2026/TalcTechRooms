// Mock storage provider - used until a real GCP bucket exists (config.storage.mode ===
// 'mock', the default). No real network call is made and no bytes are actually stored
// anywhere; this exists purely so the rest of the app (accommodation image endpoints) can be
// built and tested before a GCP project/bucket is set up.
//
// IMPORTANT LIMITATION: unlike the mock ID-verification provider (which can deterministically
// "fail" some inputs), this mock provider's confirmObjectExists() always returns true - there
// is no real object to check for. That means in mock mode, confirming an image never actually
// verifies an upload happened; it trusts the client. This is fine for local development, but
// this mock provider is not a substitute for testing the real gcsProvider before launch.

function generateObjectPath(accommodationId, contentType) {
  const ext = (contentType.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '');
  const id = require('node:crypto').randomUUID();
  return `accommodations/${accommodationId}/${id}.${ext}`;
}

async function getUploadUrl(objectPath) {
  return {
    uploadUrl: `https://mock-storage.local/upload/${encodeURIComponent(objectPath)}`,
    expiresInSeconds: 900,
  };
}

function publicUrl(objectPath) {
  return `https://mock-storage.local/public/${objectPath}`;
}

// eslint-disable-next-line no-unused-vars
async function confirmObjectExists(objectPath) {
  return true;
}

// eslint-disable-next-line no-unused-vars
async function deleteObject(objectPath) {
  // No-op - nothing was ever really stored.
}

module.exports = { generateObjectPath, getUploadUrl, publicUrl, confirmObjectExists, deleteObject };
