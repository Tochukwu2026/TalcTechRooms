import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { login as apiLogin, registerCustomer as apiRegisterCustomer, RegisterCustomerInput } from '@/api/auth';
import { setStoredToken, getStoredToken } from '@/api/client';
import type { AuthUser } from '@/api/types';

const USER_KEY = 'talctech_auth_user';

interface AuthContextValue {
  user: AuthUser | null;
  // true until the initial SecureStore check (on app launch) completes.
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  // Registers the Customer, then signs them in immediately (register itself returns no
  // token - see backend customerService.registerCustomer) so there's one smooth flow instead
  // of asking them to log in again right after signing up.
  registerAndSignIn: (input: RegisterCustomerInput) => Promise<{ idVerificationPassed: boolean }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [token, storedUser] = await Promise.all([getStoredToken(), SecureStore.getItemAsync(USER_KEY)]);
        if (token && storedUser) {
          setUser(JSON.parse(storedUser) as AuthUser);
        }
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const persistSession = useCallback(async (token: string, nextUser: AuthUser) => {
    await setStoredToken(token);
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(nextUser));
    setUser(nextUser);
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const result = await apiLogin(email, password);
      await persistSession(result.token, result.user);
    },
    [persistSession]
  );

  const registerAndSignIn = useCallback(
    async (input: RegisterCustomerInput) => {
      const result = await apiRegisterCustomer(input);
      const idVerificationPassed = result.idVerification.status === 'verified';
      // Register succeeded either way (see backend comment: a failed verification doesn't
      // lock the account out) - sign them in regardless so they land in the app and can see
      // their verification status; booking endpoints will reject them if unverified.
      const loginResult = await apiLogin(input.email, input.password);
      await persistSession(loginResult.token, loginResult.user);
      return { idVerificationPassed };
    },
    [persistSession]
  );

  const signOut = useCallback(async () => {
    await setStoredToken(null);
    await SecureStore.deleteItemAsync(USER_KEY);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, isLoading, signIn, registerAndSignIn, signOut }),
    [user, isLoading, signIn, registerAndSignIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider.');
  }
  return ctx;
}
