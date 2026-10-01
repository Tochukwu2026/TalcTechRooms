import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

// The deployed Cloud Run URL (see backend/DEPLOY.md), set in app.json > expo.extra.apiBaseUrl.
// Falls back to a placeholder so a missing config fails loudly instead of silently hitting
// nothing.
const API_BASE_URL: string =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? 'http://localhost:4000';

const TOKEN_KEY = 'talctech_auth_token';

export async function getStoredToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setStoredToken(token: string | null): Promise<void> {
  if (token) {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  } else {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }
}

export class ApiError extends Error {
  status: number;
  details: unknown;
  // The full parsed JSON error body, when there was one - some endpoints (e.g. the booking
  // verify endpoints for a failed/conflicted payment) return a machine-readable `status` field
  // of their own instead of an `error`/`message` string; callers that care check this.
  body: Record<string, unknown> | null;

  constructor(status: number, message: string, details?: unknown, body: Record<string, unknown> | null = null) {
    super(message);
    this.status = status;
    this.details = details;
    this.body = body;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  // Most endpoints need the Customer's JWT; a handful (search, listing detail, price-caps,
  // amenities, login, register) are public - set this to false for those.
  auth?: boolean;
}

function buildQueryString(query?: Record<string, string | number | undefined>): string {
  if (!query) return '';
  const entries = Object.entries(query).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return '';
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    params.append(key, String(value));
  }
  return `?${params.toString()}`;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, auth = true } = options;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (auth) {
    const token = await getStoredToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const url = `${API_BASE_URL}${path}${buildQueryString(query)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Could not reach the TalcTech Rooms server. Check your internet connection.');
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = (data && (data.error || data.message)) || `Request failed (${response.status}).`;
    throw new ApiError(response.status, message, data?.details, data ?? null);
  }

  return data as T;
}

export { API_BASE_URL };
