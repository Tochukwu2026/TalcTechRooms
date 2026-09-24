import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { apiFetch } from '../api/client.js';

const AuthContext = createContext(null);
const STORAGE_KEY = 'talctech_admin_session';

function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(loadSession);

  const login = useCallback(async (email, password) => {
    const result = await apiFetch('/auth/login', { method: 'POST', body: { email, password } });
    // The backend's /auth/login doesn't care about role - it's shared by every account type.
    // This dashboard is Admin-only, so refuse here rather than let a Renter/Customer in only to
    // have every /admin/* call 403 afterwards.
    if (result.user.role !== 'admin') {
      throw new Error('This account is not an Admin account.');
    }
    const next = { token: result.token, user: result.user };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSession(next);
    return next;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setSession(null);
  }, []);

  const value = useMemo(() => ({ session, login, logout }), [session, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
