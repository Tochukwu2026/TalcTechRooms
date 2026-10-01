// Uploads image bytes directly to the signed URL from requestImageUploadUrl - this request
// goes straight to storage (GCS, or nothing in mock mode), never through our own backend.
//
// In STORAGE_MODE=mock (the backend's default until a real GCS bucket exists - see
// backend/src/modules/storage/mockProvider.js), the signed URL is a fake, non-loadable
// placeholder (`https://mock-storage.local/...`) and PUTting to it would just fail with a
// network error. mockProvider's own confirmObjectExists() always returns true regardless ("it
// trusts the client" - see its comment), so there's nothing to actually upload yet: detect the
// placeholder host and skip the PUT, going straight to confirmAccommodationImage. Once
// STORAGE_MODE=gcs is set, the same call path performs a real PUT with no code change needed.
export function isMockStorageUrl(url: string): boolean {
  return url.includes('mock-storage.local');
}

export async function uploadImageToSignedUrl(
  uploadUrl: string,
  contentType: string,
  localUri: string
): Promise<void> {
  const fileResponse = await fetch(localUri);
  const bytes = await fileResponse.blob();

  const putResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: bytes,
  });

  if (!putResponse.ok) {
    throw new Error(`Image upload failed (${putResponse.status}). Please try again.`);
  }
}
