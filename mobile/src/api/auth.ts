import { apiRequest } from './client';
import type { ExecutiveSubscriptionPreview, LoginResponse, RegisterCustomerResponse } from './types';

export interface RegisterCustomerInput {
  email: string;
  phone?: string;
  fullName: string;
  password: string;
  gender?: string;
  tier?: 'regular' | 'executive';
  documentType: 'nin' | 'passport' | 'pvc';
  documentNumber: string;
}

export function login(email: string, password: string): Promise<LoginResponse> {
  return apiRequest<LoginResponse>('/auth/login', {
    method: 'POST',
    body: { email, password },
    auth: false,
  });
}

export function registerCustomer(input: RegisterCustomerInput): Promise<RegisterCustomerResponse> {
  return apiRequest<RegisterCustomerResponse>('/customers/register', {
    method: 'POST',
    body: input,
    auth: false,
  });
}

// Public - lets the sign-up screen show the real Executive-tier monthly price (base fee + Admin
// Costs + VAT, at whatever rates Admin currently has configured) before the person commits to
// that tier, rather than a hardcoded/guessed figure. See backend checkoutService.js.
export function getExecutiveSubscriptionPreview(): Promise<ExecutiveSubscriptionPreview> {
  return apiRequest<ExecutiveSubscriptionPreview>('/customers/executive-subscription-cost', { auth: false });
}
