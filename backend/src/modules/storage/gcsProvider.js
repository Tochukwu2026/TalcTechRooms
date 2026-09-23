// Real Google Cloud Storage provider - see spec/decisions-and-phasing.md > Hosting/
// Infrastructure (GCP was already confirmed for hosting; this reuses that same ecosystem).
//
// IMPORTANT / NOT YET VERIFIED: this was written from the @google-cloud/storage SDK's
// published docs, without a real GCP project/bucket/service account to test against - the
// decisions log's own "[Still to do: actual GCP project setup...]" note hasn't happened yet.
// Before switching STORAGE_MODE from 'mock' to 'gcs' in any real environment:
//   1. Create the GCS bucket and a service account with Storage Object Admin on it (or a
//      narrower custom role - Object Admin is broader than strictly needed).
//   2. Decide how images are actually served publicly: either make the bucket public-read
//      (simplest, what publicUrl() below assumes) or front it with a CDN/signed read URLs
//      (more secure, not built here).
//   3. Point GOOGLE_APPLICATION_CREDENTIALS at the service account key (or use workload
//      identity on Cloud Run instead of a key file, which is the better production pattern
//      but needs its own setup).
//   4. Actually upload a file end-to-end with a signed URL from a real client and confirm it
//      lands in the bucket and confirmObjectExists() finds it.

const config = require('../../config');

let storageClient = null;
function getClient() {
  if (!storageClient) {
    // Lazily require + construct so a 'mock'-mode process never needs this package installed
    // to actually work, and so a missing/misconfigured credential doesn't crash at boot.
    // eslint-disable-next-line global-require
    const { Storage } = require('@google-cloud/storage');
    storageClient = new Storage({ projectId: config.storage.gcs.projectId || undefined });
  }
  return storageClient;
}

function getBucket() {
  const { bucketName } = config.storage.gcs;
  if (!bucketName) {
    throw new Error('GCS_BUCKET_NAME is not set. Set STORAGE_MODE=mock until a real bucket exists.');
  }
  return getClient().bucket(bucketName);
}

function generateObjectPath(accommodationId, contentType) {
  const ext = (contentType.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '');
  const id = require('node:crypto').randomUUID();
  return `accommodations/${accommodationId}/${id}.${ext}`;
}

async function getUploadUrl(objectPath, contentType) {
  const file = getBucket().file(objectPath);
  const expiresInSeconds = 900; // 15 minutes
  const [uploadUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + expiresInSeconds * 1000,
    contentType,
  });
  return { uploadUrl, expiresInSeconds };
}

function publicUrl(objectPath) {
  if (config.storage.gcs.publicBaseUrl) {
    return `${config.storage.gcs.publicBaseUrl.replace(/\/$/, '')}/${objectPath}`;
  }
  return `https://storage.googleapis.com/${config.storage.gcs.bucketName}/${objectPath}`;
}

async function confirmObjectExists(objectPath) {
  const [exists] = await getBucket().file(objectPath).exists();
  return exists;
}

async function deleteObject(objectPath) {
  try {
    await getBucket().file(objectPath).delete();
  } catch (err) {
    // Best-effort: the DB row is the source of truth for what's "attached" to a listing, so
    // a bucket-delete failure (e.g. already gone) shouldn't fail the API request.
    // eslint-disable-next-line no-console
    console.error(`Failed to delete GCS object ${objectPath}:`, err.message);
  }
}

module.exports = { generateObjectPath, getUploadUrl, publicUrl, confirmObjectExists, deleteObject };
