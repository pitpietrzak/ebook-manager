import * as SecureStore from 'expo-secure-store';
import { supabase } from './supabase';

const GOOGLE_TOKEN_KEY = 'google_provider_token';
const GOOGLE_REFRESH_TOKEN_KEY = 'google_provider_refresh_token';
const GOOGLE_TOKEN_EXPIRY_KEY = 'google_provider_token_expires_at';
const DEFAULT_TOKEN_LIFETIME_SECONDS = 55 * 60;
const EXPIRY_BUFFER_MS = 60 * 1000;

function normalizeErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as any).message || '');
  }
  return '';
}

export function isGoogleAuthError(rawMessage?: string): boolean {
  const message = (rawMessage || '').toLowerCase();
  if (!message) return false;

  return [
    'session expired',
    'google drive session expired',
    'invalid_grant',
    'invalid_request',
    'invalid credentials',
    'login required',
    'insufficient authentication',
    'unauthorized',
    '401',
    'token',
    'auth',
  ].some((fragment) => message.includes(fragment));
}

export async function saveGoogleAuth(
  providerToken: string,
  expiresInSeconds?: number | null,
  refreshToken?: string | null
) {
  await SecureStore.setItemAsync(GOOGLE_TOKEN_KEY, providerToken);

  const expiresAt = Date.now() + (Number(expiresInSeconds || DEFAULT_TOKEN_LIFETIME_SECONDS) * 1000);
  await SecureStore.setItemAsync(GOOGLE_TOKEN_EXPIRY_KEY, String(expiresAt));

  if (refreshToken) {
    await SecureStore.setItemAsync(GOOGLE_REFRESH_TOKEN_KEY, refreshToken);
  }
}

export async function clearGoogleAuth() {
  await Promise.all([
    SecureStore.deleteItemAsync(GOOGLE_TOKEN_KEY),
    SecureStore.deleteItemAsync(GOOGLE_REFRESH_TOKEN_KEY),
    SecureStore.deleteItemAsync(GOOGLE_TOKEN_EXPIRY_KEY),
  ]);
}

async function signOutDueToExpiredGoogleSession() {
  await clearGoogleAuth();
  try {
    await supabase.auth.signOut();
  } catch {}
}

export async function validateGoogleSessionOnAppOpen(): Promise<void> {
  const storedToken = await SecureStore.getItemAsync(GOOGLE_TOKEN_KEY);
  const refreshToken = await SecureStore.getItemAsync(GOOGLE_REFRESH_TOKEN_KEY);
  const storedExpiry = await SecureStore.getItemAsync(GOOGLE_TOKEN_EXPIRY_KEY);
  const expiresAt = Number(storedExpiry || '0');

  if (!storedToken && !refreshToken) {
    await signOutDueToExpiredGoogleSession();
    throw new Error('Google Drive session expired. Please sign in again.');
  }

  if (!expiresAt || expiresAt - Date.now() <= EXPIRY_BUFFER_MS) {
    await getValidGoogleAccessToken();
  }
}

export async function getValidGoogleAccessToken(options?: { forceRefresh?: boolean }): Promise<string> {
  const forceRefresh = options?.forceRefresh === true;
  const storedToken = await SecureStore.getItemAsync(GOOGLE_TOKEN_KEY);
  const storedExpiry = await SecureStore.getItemAsync(GOOGLE_TOKEN_EXPIRY_KEY);
  const expiresAt = Number(storedExpiry || '0');

  if (!forceRefresh && storedToken && (!expiresAt || expiresAt - Date.now() > EXPIRY_BUFFER_MS)) {
    return storedToken;
  }

  const refreshToken = await SecureStore.getItemAsync(GOOGLE_REFRESH_TOKEN_KEY);
  const clientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;

  if (!refreshToken || !clientId) {
    await signOutDueToExpiredGoogleSession();
    throw new Error('Google Drive session expired. Please sign in again.');
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  });

  const data = await response.json();

  if (!response.ok || !data?.access_token) {
    if (data?.error === 'invalid_client' || data?.error === 'unauthorized_client') {
      throw new Error('Google OAuth client mismatch. Ensure EXPO_PUBLIC_GOOGLE_CLIENT_ID matches the Google client configured in Supabase Auth > Providers > Google.');
    }

    if (data?.error === 'invalid_grant' || data?.error === 'invalid_request') {
      await signOutDueToExpiredGoogleSession();
      throw new Error('Google Drive session expired. Please sign in again.');
    }

    throw new Error(data?.error_description || data?.error || 'Could not refresh Google Drive access.');
  }

  await saveGoogleAuth(data.access_token, data.expires_in, data.refresh_token || refreshToken);
  return data.access_token;
}

export async function withGoogleAccessTokenRetry<T>(
  operation: (providerToken: string) => Promise<T>
): Promise<T> {
  const providerToken = await getValidGoogleAccessToken();

  try {
    return await operation(providerToken);
  } catch (error) {
    const errorMessage = normalizeErrorMessage(error);
    if (!isGoogleAuthError(errorMessage)) {
      throw error;
    }

    const refreshedToken = await getValidGoogleAccessToken({ forceRefresh: true });
    return operation(refreshedToken);
  }
}
