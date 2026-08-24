import * as SecureStore from 'expo-secure-store';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { env, hasSupabaseConfig } from '@/lib/env';

export type AuthSession = {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  user: {
    email?: string;
    id: string;
  };
};

function withExpiry(session: AuthSession) {
  return session.expires_at
    ? session
    : { ...session, expires_at: Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600) };
}

type AuthContextValue = {
  createRecoveryCode: () => Promise<{ code: string; expiresAt: string }>;
  isLoading: boolean;
  session: AuthSession | null;
  redeemRecoveryCode: (code: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
};

const sessionKey = 'nudge.authSession';
const AuthContext = createContext<AuthContextValue | null>(null);

function isWeb() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

async function saveSession(session: AuthSession | null) {
  if (isWeb()) {
    if (session) window.localStorage.setItem(sessionKey, JSON.stringify(session));
    else window.localStorage.removeItem(sessionKey);
    return;
  }

  if (session) await SecureStore.setItemAsync(sessionKey, JSON.stringify(session));
  else await SecureStore.deleteItemAsync(sessionKey);
}

async function loadSession() {
  const value = isWeb()
    ? window.localStorage.getItem(sessionKey)
    : await SecureStore.getItemAsync(sessionKey);
  if (!value) return null;

  try {
    return JSON.parse(value) as AuthSession;
  } catch {
    await saveSession(null);
    return null;
  }
}

export async function getAuthSession() {
  const session = await loadSession();
  if (!session || !session.expires_at || session.expires_at * 1000 > Date.now() + 60_000) return session;

  try {
    const refreshed = withExpiry(await authRequest<AuthSession>('token?grant_type=refresh_token', {
      refresh_token: session.refresh_token,
    }));
    await saveSession(refreshed);
    return refreshed;
  } catch {
    return session;
  }
}

async function authRequest<T>(path: string, body: Record<string, unknown>) {
  if (!hasSupabaseConfig()) {
    throw new Error('Cloud sync is unavailable in this build.');
  }

  const response = await fetch(`${env.supabaseUrl.replace(/\/$/, '')}/auth/v1/${path}`, {
    body: JSON.stringify(body),
    headers: {
      apikey: env.supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description ?? data.msg ?? data.message ?? 'Authentication failed.');
  return data as T;
}

async function functionRequest<T>(name: string, body: Record<string, unknown>) {
  const session = await getAuthSession();
  if (!session?.access_token) throw new Error('Sync is not available until Supabase is configured.');

  const response = await fetch(`${env.supabaseUrl.replace(/\/$/, '')}/functions/v1/${name}`, {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      apikey: env.supabaseAnonKey,
    },
    method: 'POST',
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? data.message ?? 'Sync request failed.');
  return data as T;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    loadSession()
      .then(async (storedSession) => {
        if (storedSession || !hasSupabaseConfig()) return storedSession;

        try {
          return withExpiry(await authRequest<AuthSession>('signup', { data: {} }));
        } catch {
          // Local-only mode remains usable if the developer backend is unavailable.
          return null;
        }
      })
      .then(async (nextSession) => {
        if (!isMounted) return;
        if (nextSession) {
          await saveSession(nextSession);
          setSession(nextSession);
        }
        setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  async function signIn(email: string, password: string) {
    const nextSession = withExpiry(await authRequest<AuthSession>('token?grant_type=password', { email, password }));
    await saveSession(nextSession);
    setSession(nextSession);
  }

  async function signUp(email: string, password: string) {
    const nextSession = withExpiry(await authRequest<AuthSession>('signup', { email, password }));
    if (nextSession.access_token) {
      await saveSession(nextSession);
      setSession(nextSession);
    } else {
      throw new Error('Account created. Check your email to confirm it, then sign in.');
    }
  }

  async function signOut() {
    if (session?.access_token && hasSupabaseConfig()) {
      await fetch(`${env.supabaseUrl.replace(/\/$/, '')}/auth/v1/logout`, {
        headers: { Authorization: `Bearer ${session.access_token}`, apikey: env.supabaseAnonKey },
        method: 'POST',
      }).catch(() => undefined);
    }
    await saveSession(null);
    setSession(null);
  }

  async function createRecoveryCode() {
    return functionRequest<{ code: string; expiresAt: string }>('create-recovery-code', {});
  }

  async function redeemRecoveryCode(code: string) {
    const credentials = await fetch(`${env.supabaseUrl.replace(/\/$/, '')}/functions/v1/redeem-recovery-code`, {
      body: JSON.stringify({ code }),
      headers: { 'Content-Type': 'application/json', apikey: env.supabaseAnonKey },
      method: 'POST',
    }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? data.message ?? 'Could not redeem recovery code.');
      return data as { email: string; password: string };
    });
    await signIn(credentials.email, credentials.password);
  }

  const value = useMemo(
    () => ({ createRecoveryCode, isLoading, redeemRecoveryCode, session, signIn, signOut, signUp }),
    [isLoading, session]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
