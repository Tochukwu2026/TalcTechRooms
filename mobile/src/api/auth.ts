import { apiRequest } from './client';
import type { LoginResponse, RegisterCustomerResponse } from './types';

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
