// TypeScript shapes matching the real backend's JSON responses exactly (field names and
// casing), taken directly from backend/src/routes + backend/src/modules at the time this was
// written. The backend returns listing/accommodation rows mostly in raw snake_case (straight
// from SQL - see accommodationService.js's LISTING_COLUMNS), while booking rows are mapped to
// camelCase (see bookingService.toBookingResponse) - these two conventions are intentionally
// different in the real API, not a mistake here.

export type UserRole = 'renter' | 'customer' | 'admin' | 'staff';

export interface AuthUser {
  id: string | number;
  role: UserRole;
  email: string;
  fullName: string;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

export interface RegisterCustomerResponse {
  user: {
    id: string | number;
    role: UserRole;
    email: string;
    full_name: string;
    created_at: string;
  };
  tier: 'regular' | 'executive';
  active: boolean;
  idVerification: {
    id: string | number;
    status: 'verified' | 'failed';
    provider: string;
    cost_naira: string | number;
    verified_at: string | null;
  };
}

export type AccommodationType =
  | 'room'
  | 'studio'
  | 'one_bedroom_apartment'
  | 'bungalow'
  | 'multiple_rooms_apartment'
  | 'duplex_house'
  | 'beach_house';

export interface AccommodationImage {
  id: string | number;
  url: string;
  position: number;
}

export interface AccommodationAmenity {
  id: string | number;
  name: string;
}

// Public listing shape (search results + single-listing view) - contact_info is always
// stripped server-side for these endpoints (see accommodationService.stripContactInfo).
export interface PublicAccommodation {
  id: string | number;
  renter_user_id: string | number;
  type: AccommodationType;
  location_text: string;
  description: string;
  number_of_units: number;
  units_available: number;
  nightly_rent_naira: string | number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  state: string;
  area: string | null;
  price_cap_naira: string | number;
  images: AccommodationImage[];
  amenities: AccommodationAmenity[];
  viewingAvailability: { available_date: string; is_booked: boolean }[];
  // Only present on /search results when checkIn/checkOut were given.
  unitsAvailableForDates?: number;
}

export interface AvailabilityResponse {
  accommodationId: number;
  checkIn: string;
  checkOut: string;
  nights: number;
  numberOfUnits: number;
  unitsAvailable: number;
  nightlyRentNaira: number;
}

export interface CheckoutPreview {
  accommodationId: number;
  checkIn: string;
  checkOut: string;
  nights: number;
  unitsRequested: number;
  unitsAvailable: number;
  nightlyRentNaira: number;
  rentNaira: number;
  adminCostsNaira: number;
  vatNaira: number;
  totalChargedNaira: number;
  commissionNaira: number;
  renterGrossPayoutNaira: number;
}

export interface InitializeBookingResponse {
  reference: string;
  authorizationUrl: string;
  accommodationId: number;
  checkIn: string;
  checkOut: string;
  units: number;
  totalChargedNaira: number;
}

export type BookingStatus = 'active' | 'held' | 'canceled' | 'completed';

// Booking rows ARE mapped to camelCase server-side (bookingService.toBookingResponse) -
// different convention from the accommodation rows above, intentionally.
export interface Booking {
  id: string | number;
  accommodationId: number;
  customerUserId: string | number;
  checkInDate: string;
  checkOutDate: string;
  unitsBooked: number;
  rentNaira: number;
  adminCostsNaira: number;
  vatNaira: number;
  totalChargedNaira: number;
  commissionNaira: number;
  renterGrossPayoutNaira: number;
  renterNetPayoutNaira: number;
  status: BookingStatus;
  [key: string]: unknown;
}

export interface VerifyBookingResult {
  status?: 'payment_failed' | 'availability_conflict_refunded' | 'availability_conflict_refund_failed';
  message?: string;
}

export interface PriceCap {
  id: string | number;
  state: string;
  area: string | null;
  cap_naira: string | number;
}

export interface Amenity {
  id: string | number;
  name: string;
}

export interface ApiErrorBody {
  error: string;
  details?: unknown;
}
