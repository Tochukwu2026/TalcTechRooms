import { apiRequest } from './client';
import type { CustomerProfile, InitializeUpgradeResponse, VerifyUpgradeResponse } from './types';

export function getMyProfile(): Promise<CustomerProfile> {
  return apiRequest<CustomerProfile>('/customers/me');
}

// Only the fields being changed need to be sent. Changing the email also needs currentPassword
// (the backend refuses otherwise); phone does not.
export function updateMyProfile(changes: {
  email?: string;
  phone?: string;
  currentPassword?: string;
}): Promise<CustomerProfile> {
  return apiRequest<CustomerProfile>('/customers/me', { method: 'PATCH', body: changes });
}

export function changeMyPassword(currentPassword: string, newPassword: string): Promise<{ changed: boolean }> {
  return apiRequest<{ changed: boolean }>('/customers/me/password', {
    method: 'POST',
    body: { currentPassword, newPassword },
  });
}

export function initializeExecutiveUpgrade(): Promise<InitializeUpgradeResponse> {
  return apiRequest<InitializeUpgradeResponse>('/customers/me/executive-upgrade/initialize', { method: 'POST' });
}

// Called after the Paystack checkout WebView closes - safe to call more than once (the backend
// finalizes a given payment only once).
export function verifyExecutiveUpgrade(reference: string): Promise<VerifyUpgradeResponse> {
  return apiRequest<VerifyUpgradeResponse>(`/customers/me/executive-upgrade/verify/${reference}`, {
    method: 'POST',
  });
}

// Switches monthly Executive auto-renewal on or off. Off = keep Executive until the paid month ends,
// then become Regular.
export function setAutoRenew(autoRenew: boolean): Promise<CustomerProfile> {
  return apiRequest<CustomerProfile>('/customers/me/subscription', { method: 'PATCH', body: { autoRenew } });
}
