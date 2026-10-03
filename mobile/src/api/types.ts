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
  // Only present when role === 'customer' (see authService.login) - 'executive' gates the
  // Live/Video Viewing booking feature on this screen; 'regular' Customers never see it.
  tier?: 'regular' | 'executive';
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

// --- Renter-specific shapes ---

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface RegisterRenterResponse {
  user: {
    id: string | number;
    role: UserRole;
    email: string;
    full_name: string;
    created_at: string;
  };
  approvalStatus: ApprovalStatus;
  idVerification: {
    id: string | number;
    status: 'verified' | 'failed';
    provider: string;
    cost_naira: string | number;
    verified_at: string | null;
  };
}

// GET /renters/me - a mix of snake_case (straight from the renters table, same convention as
// listing rows) and the bank fields, which are null until updateBankDetails has been called.
export interface RenterMe {
  id: string | number;
  email: string;
  phone: string | null;
  full_name: string;
  address: string;
  approval_status: ApprovalStatus;
  approved_at: string | null;
  rejection_reason: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
}

export interface BankDetailsInput {
  bankName: string;
  bankAccountNumber: string;
  bankAccountName: string;
}

// Renter-owned listing CRUD uses the same PublicAccommodation shape, except contact_info is
// NOT stripped (the owner is allowed to see their own contact info) - a separate interface so
// that distinction stays visible at the type level, even though the fields otherwise match.
export interface OwnAccommodation extends Omit<PublicAccommodation, 'unitsAvailableForDates'> {
  contact_info: string;
}

export interface CreateAccommodationInput {
  type: AccommodationType;
  state: string;
  area?: string;
  locationText: string;
  description: string;
  contactInfo: string;
  numberOfUnits: number;
  nightlyRentNaira: number;
  amenities?: string[];
}

export type UpdateAccommodationInput = Partial<
  Omit<CreateAccommodationInput, 'amenities'>
>;

export interface RequestImageUploadUrlResponse {
  uploadUrl: string;
  objectPath: string;
  publicUrl: string;
  expiresInSeconds: number;
}

// --- Executive Feature Viewing bookings (Customer-facing) ---

export type ViewingType = 'live' | 'video';
export type ViewingStatus = 'scheduled' | 'cancelled' | 'completed';

// GET /accommodations/:id/viewings/video-availability and .../live-availability both return
// this same shape (see viewingService.getVideoAvailability / getLiveAvailability) - `dates` is
// a plain calendar list of the next 30 days for video, or only the Renter-marked/still-unbooked
// dates for live.
export interface ViewingAvailabilityResponse {
  viewingType: ViewingType;
  dates: string[];
}

// POST /accommodations/:id/viewings and GET /customers/me/viewings both return viewing_bookings
// rows mapped to camelCase (see viewingService.toViewingResponse) - same convention as Booking.
export interface Viewing {
  id: string | number;
  customerUserId: string | number;
  accommodationId: string | number;
  viewingType: ViewingType;
  scheduledDate: string;
  status: ViewingStatus;
  assignedStaffUserId: string | number | null;
  createdAt: string;
}

export interface BookViewingInput {
  viewingType: ViewingType;
  scheduledDate: string;
}

// GET /customers/executive-subscription-cost - see checkoutService.getExecutiveSubscriptionPreview.
export interface ExecutiveSubscriptionPreview {
  baseFeeNaira: number;
  adminCostsNaira: number;
  vatNaira: number;
  totalChargedNaira: number;
}
