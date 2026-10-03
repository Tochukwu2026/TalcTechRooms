import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import { login as apiLogin, registerCustomer as apiRegisterCustomer, RegisterCustomerInput } from '@/api/auth';
import { registerRenter as apiRegisterRenter, RegisterRenterInput } from '@/api/renters';
import { setStoredToken, getStoredToken } from '@/api/client';
import type { AuthUser } from '@/api/types';

const USER_KEY = 'talctech_auth_user';

interface AuthContextValue {
  user: AuthUser | null;
  // true until the initial SecureStore check (on app launch) completes.
  isLoading: boolean;
  // Returns the signed-in user so a caller (e.g. the login screen) can route by role without
  // waiting on a state update to propagate.
  signIn: (email: string, password: string) => Promise<AuthUser>;
  // Registers the Customer, then signs them in immediately (register itself returns no
  // token - see backend customerService.registerCustomer) so there's one smooth flow instead
  // of asking them to log in again right after signing up.
  registerAndSignIn: (input: RegisterCustomerInput) => Promise<{ idVerificationPassed: boolean }>;
  // Same pattern as registerAndSignIn: registerRenter (backend renterService.registerRenter)
  // returns no token either, and succeeds regardless of whether ID verification or Admin
  // approval has happened yet - both of those are checked later (verification already ran;
  // approval is a separate manual Admin step - see renterRoutes.js/adminService), not here.
  registerRenterAndSignIn: (input: RegisterRenterInput) => Promise<{ idVerificationPassed: boolean }>;
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
      return result.user;
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

  const registerRenterAndSignIn = useCallback(
    async (input: RegisterRenterInput) => {
      const result = await apiRegisterRenter(input);
      const idVerificationPassed = result.idVerification.status === 'verified';
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
    // Clearing `user` alone doesn't move the app off whatever screen is currently showing
    // (expo-router doesn't automatically redirect just because the auth state changed) - without
    // this, the signed-out Renter/Customer screen just sits there (its own data-fetch may even
    // spin forever once the token is gone and its request 401s). Route back to the launch
    // screen, which re-checks `user` and redirects to /(auth)/login for a null user.
    router.replace('/');
  }, []);

  const value = useMemo(
    () => ({ user, isLoading, signIn, registerAndSignIn, registerRenterAndSignIn, signOut }),
    [user, isLoading, signIn, registerAndSignIn, registerRenterAndSignIn, signOut]
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
