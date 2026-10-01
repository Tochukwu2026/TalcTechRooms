import { apiRequest } from './client';
import type { Booking, InitializeBookingResponse } from './types';

export function initializeBooking(
  accommodationId: number | string,
  checkIn: string,
  checkOut: string,
  units: number = 1
): Promise<InitializeBookingResponse> {
  return apiRequest<InitializeBookingResponse>(`/accommodations/${accommodationId}/bookings/initialize`, {
    method: 'POST',
    body: { checkIn, checkOut, units },
  });
}

// Called after the Paystack checkout WebView redirects back (or is manually closed once
// payment completes) - safe to call more than once, see backend bookingRoutes.js comment.
export function verifyBooking(reference: string): Promise<Booking> {
  return apiRequest<Booking>(`/bookings/verify/${reference}`, { method: 'POST' });
}

export function getBooking(id: number | string): Promise<Booking> {
  return apiRequest<Booking>(`/bookings/${id}`);
}
