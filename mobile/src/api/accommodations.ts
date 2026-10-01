import { apiRequest } from './client';
import type {
  AccommodationType,
  Amenity,
  AvailabilityResponse,
  CheckoutPreview,
  PriceCap,
  PublicAccommodation,
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
