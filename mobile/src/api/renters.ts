import { apiRequest } from './client';
import type { BankDetailsInput, RegisterRenterResponse, RenterMe } from './types';

export interface RegisterRenterInput {
  email: string;
  phone?: string;
  fullName: string;
  password: string;
  address: string;
  documentType: 'nin' | 'passport' | 'pvc';
  documentNumber: string;
}

export function registerRenter(input: RegisterRenterInput): Promise<RegisterRenterResponse> {
  return apiRequest<RegisterRenterResponse>('/renters/register', {
    method: 'POST',
    body: input,
    auth: false,
  });
}

export function getRenterMe(): Promise<RenterMe> {
  return apiRequest<RenterMe>('/renters/me');
}

export function updateBankDetails(input: BankDetailsInput): Promise<RenterMe> {
  return apiRequest<RenterMe>('/renters/me/bank-details', {
    method: 'PATCH',
    body: input,
  });
}
