import { apiRequest } from './client';
import type {
  AccommodationType,
  Amenity,
  AvailabilityResponse,
  CheckoutPreview,
  CreateAccommodationInput,
  OwnAccommodation,
  PriceCap,
  PublicAccommodation,
  RequestImageUploadUrlResponse,
  UpdateAccommodationInput,
} from './types';

export interface SearchParams {
  state?: string;
  area?: string;
  type?: AccommodationType;
  checkIn?: string;
  checkOut?: string;
  minPrice?: number;
  maxPrice?: number;
  [key: string]: string | number | undefined;
}

export function searchAccommodations(params: SearchParams = {}): Promise<PublicAccommodation[]> {
  return apiRequest<PublicAccommodation[]>('/accommodations/search', {
    query: params,
    auth: false,
  });
}

export function getAccommodation(id: number | string): Promise<PublicAccommodation> {
  return apiRequest<PublicAccommodation>(`/accommodations/${id}`, { auth: false });
}

export function getAvailability(
  id: number | string,
  checkIn: string,
  checkOut: string
): Promise<AvailabilityResponse> {
  return apiRequest<AvailabilityResponse>(`/accommodations/${id}/availability`, {
    query: { checkIn, checkOut },
    auth: false,
  });
}

export function getCheckoutPreview(
  id: number | string,
  checkIn: string,
  checkOut: string,
  units: number = 1
): Promise<CheckoutPreview> {
  return apiRequest<CheckoutPreview>(`/accommodations/${id}/checkout-preview`, {
    query: { checkIn, checkOut, units },
    auth: false,
  });
}

export function listPriceCaps(): Promise<PriceCap[]> {
  return apiRequest<PriceCap[]>('/accommodations/price-caps', { auth: false });
}

export function listAmenities(): Promise<Amenity[]> {
  return apiRequest<Amenity[]>('/accommodations/amenities', { auth: false });
}

// --- Renter-owned CRUD (everything below requires an authenticated, approved Renter - the
// backend 403s createAccommodation for a Renter whose approval_status isn't 'approved' yet,
// but still lets them view/manage listings they already created before e.g. being suspended) ---

export function createAccommodation(input: CreateAccommodationInput): Promise<OwnAccommodation> {
  return apiRequest<OwnAccommodation>('/accommodations', { method: 'POST', body: input });
}

export function listOwnAccommodations(): Promise<OwnAccommodation[]> {
  return apiRequest<OwnAccommodation[]>('/accommodations');
}

export function getOwnAccommodation(id: number | string): Promise<OwnAccommodation> {
  return apiRequest<OwnAccommodation>(`/accommodations/mine/${id}`);
}

export function updateAccommodation(
  id: number | string,
  input: UpdateAccommodationInput
): Promise<OwnAccommodation> {
  return apiRequest<OwnAccommodation>(`/accommodations/${id}`, { method: 'PATCH', body: input });
}

export function setAccommodationActive(
  id: number | string,
  isActive: boolean
): Promise<OwnAccommodation> {
  return apiRequest<OwnAccommodation>(`/accommodations/${id}/${isActive ? 'reactivate' : 'deactivate'}`, {
    method: 'POST',
  });
}

export function replaceAmenities(
  id: number | string,
  amenities: string[]
): Promise<OwnAccommodation> {
  return apiRequest<OwnAccommodation>(`/accommodations/${id}/amenities`, {
    method: 'PUT',
    body: { amenities },
  });
}

export function requestImageUploadUrl(
  id: number | string,
  contentType: 'image/jpeg' | 'image/png' | 'image/webp'
): Promise<RequestImageUploadUrlResponse> {
  return apiRequest<RequestImageUploadUrlResponse>(`/accommodations/${id}/images/upload-url`, {
    method: 'POST',
    body: { contentType },
  });
}

export function confirmAccommodationImage(
  id: number | string,
  objectPath: string
): Promise<OwnAccommodation> {
  return apiRequest<OwnAccommodation>(`/accommodations/${id}/images`, {
    method: 'POST',
    body: { objectPath },
  });
}

export function removeAccommodationImage(
  id: number | string,
  imageId: number | string
): Promise<OwnAccommodation> {
  return apiRequest<OwnAccommodation>(`/accommodations/${id}/images/${imageId}`, { method: 'DELETE' });
}

export function setViewingAvailability(
  id: number | string,
  dates: string[]
): Promise<OwnAccommodation> {
  return apiRequest<OwnAccommodation>(`/accommodations/${id}/viewing-availability`, {
    method: 'POST',
    body: { dates },
  });
}

export function removeViewingAvailability(
  id: number | string,
  date: string
): Promise<OwnAccommodation> {
  return apiRequest<OwnAccommodation>(`/accommodations/${id}/viewing-availability/${date}`, {
    method: 'DELETE',
  });
}
