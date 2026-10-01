import { apiRequest } from './client';
import type { BookViewingInput, Viewing, ViewingAvailabilityResponse } from './types';

// Executive Feature Viewing bookings (Live/Video) - see backend viewingService.js. All of these
// 403 server-side for a non-Executive Customer (viewingService.assertExecutiveCustomer); the
// mobile UI additionally gates on AuthUser.tier so a Regular Customer never sees the tab at all,
// matching the spec's "dead/disabled for Regular Customers" wording.

export function getVideoAvailability(accommodationId: number | string): Promise<ViewingAvailabilityResponse> {
  return apiRequest<ViewingAvailabilityResponse>(`/accommodations/${accommodationId}/viewings/video-availability`);
}

export function getLiveAvailability(accommodationId: number | string): Promise<ViewingAvailabilityResponse> {
  return apiRequest<ViewingAvailabilityResponse>(`/accommodations/${accommodationId}/viewings/live-availability`);
}

export function bookViewing(accommodationId: number | string, input: BookViewingInput): Promise<Viewing> {
  return apiRequest<Viewing>(`/accommodations/${accommodationId}/viewings`, {
    method: 'POST',
    body: input,
  });
}

export function listMyViewings(): Promise<Viewing[]> {
  return apiRequest<Viewing[]>('/customers/me/viewings');
}

export function cancelViewing(viewingId: number | string): Promise<{ id: number | string; status: string }> {
  return apiRequest(`/customers/me/viewings/${viewingId}/cancel`, { method: 'POST' });
}
