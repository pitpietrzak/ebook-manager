import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const isWeb = Platform.OS === 'web';

// On web, Google sign-in returns via a full-page redirect with the tokens in
// the URL hash. supabase-js picks up the session from it and clears the hash,
// so grab the Google provider tokens first — googleAuth.ts consumes them once
// the user is signed in (see validateGoogleSessionOnAppOpen).
export type PendingProviderTokens = {
  providerToken: string | null;
  providerRefreshToken: string | null;
};

export let pendingWebProviderTokens: PendingProviderTokens | null = null;

if (isWeb && typeof window !== 'undefined' && window.location.hash.includes('provider_token')) {
  const params = new URLSearchParams(window.location.hash.slice(1));
  pendingWebProviderTokens = {
    providerToken: params.get('provider_token'),
    providerRefreshToken: params.get('provider_refresh_token'),
  };
}

export function takePendingWebProviderTokens(): PendingProviderTokens | null {
  const tokens = pendingWebProviderTokens;
  pendingWebProviderTokens = null;
  return tokens;
}

const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim();
const supabaseAnonKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').trim();

const FALLBACK_SUPABASE_URL = 'https://invalid.localhost';
const FALLBACK_SUPABASE_ANON_KEY = 'invalid-anon-key';

export function getSupabaseConfigError(): string | null {
  if (!supabaseUrl) {
    return 'Missing EXPO_PUBLIC_SUPABASE_URL';
  }

  try {
    const parsed = new URL(supabaseUrl);
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      return 'EXPO_PUBLIC_SUPABASE_URL must start with http:// or https://';
    }
  } catch {
    return 'EXPO_PUBLIC_SUPABASE_URL is not a valid URL';
  }

  if (!supabaseAnonKey) {
    return 'Missing EXPO_PUBLIC_SUPABASE_ANON_KEY';
  }

  return null;
}

const configError = getSupabaseConfigError();
if (configError) {
  console.warn('[Supabase] Invalid config detected:', configError);
}

export const supabase = createClient(
  configError ? FALLBACK_SUPABASE_URL : supabaseUrl,
  configError ? FALLBACK_SUPABASE_ANON_KEY : supabaseAnonKey,
  {
  auth: {
    // Web: default localStorage + read the session from the OAuth redirect URL.
    // Native: AsyncStorage, and the session is set manually from the deep link.
    ...(isWeb ? {} : { storage: AsyncStorage }),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: isWeb,
    flowType: 'implicit',
  },
});
