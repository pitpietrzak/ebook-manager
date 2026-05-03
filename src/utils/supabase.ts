import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim();
const supabaseAnonKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').trim();

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

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
