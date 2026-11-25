import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import * as Linking from 'expo-linking';
import { getSupabaseConfigError, supabase, takePendingWebProviderTokens } from './supabase';
import { deleteSecureItem, getSecureItem, setSecureItem } from './secureStorage';

const isWeb = Platform.OS === 'web';

if (!isWeb) {
  WebBrowser.maybeCompleteAuthSession();
}

const GOOGLE_SCOPES = 'openid profile email https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/gmail.send';

const RECONNECT_HINT = 'Reconnect Google Drive from Profile to keep syncing, sending to Kindle, and moving books between folders.';

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
  await setSecureItem(GOOGLE_TOKEN_KEY, providerToken);

  const expiresAt = Date.now() + (Number(expiresInSeconds || DEFAULT_TOKEN_LIFETIME_SECONDS) * 1000);
  await setSecureItem(GOOGLE_TOKEN_EXPIRY_KEY, String(expiresAt));

  // On web the refresh token lives server-side (google-token edge function).
  if (refreshToken && !isWeb) {
    await setSecureItem(GOOGLE_REFRESH_TOKEN_KEY, refreshToken);
  }
}

// --- Web: refresh token is held by the `google-token` edge function ---------

async function callGoogleTokenFunction(body: Record<string, unknown>): Promise<any> {
  const { data, error } = await supabase.functions.invoke('google-token', { body });
  if (!error) return data;

  // Non-2xx: pull the JSON error message out of the response body.
  let message = error.message;
  let code: string | undefined;
  try {
    const payload = await (error as any).context?.json?.();
    if (payload?.error) message = payload.error;
    code = payload?.code;
  } catch {
    // keep generic message
  }
  const err = new Error(message) as Error & { code?: string };
  err.code = code;
  throw err;
}

async function refreshViaServer(): Promise<string> {
  try {
    const data = await callGoogleTokenFunction({ action: 'refresh' });
    await saveGoogleAuth(data.access_token, data.expires_in);
    return data.access_token;
  } catch (e: any) {
    if (e?.code === 'reconnect') {
      await clearLocalGoogleAuth();
      throw new Error(`Google Drive access expired. ${RECONNECT_HINT}`);
    }
    throw e;
  }
}

// Called once after the OAuth redirect lands back on the web app.
async function consumeWebRedirectTokens(): Promise<void> {
  const pending = takePendingWebProviderTokens();
  if (!pending?.providerToken) return;

  await saveGoogleAuth(pending.providerToken);
  if (pending.providerRefreshToken) {
    await callGoogleTokenFunction({ action: 'store', refreshToken: pending.providerRefreshToken });
  } else {
    console.warn('[googleAuth] Google did not return a refresh token; Drive access will need reconnecting in ~1h.');
  }
}

async function clearLocalGoogleAuth() {
  await Promise.all([
    deleteSecureItem(GOOGLE_TOKEN_KEY),
    deleteSecureItem(GOOGLE_REFRESH_TOKEN_KEY),
    deleteSecureItem(GOOGLE_TOKEN_EXPIRY_KEY),
  ]);
}

// Call before supabase.auth.signOut() so the server-side token can be removed
// while the user's session is still valid.
export async function clearGoogleAuth() {
  if (isWeb) {
    await callGoogleTokenFunction({ action: 'clear' }).catch(() => {});
  }
  await clearLocalGoogleAuth();
}

export async function validateGoogleSessionOnAppOpen(): Promise<void> {
  if (isWeb) {
    // Returning from the Google redirect: stash the new tokens. Otherwise
    // nothing to do up front — access tokens are fetched lazily on demand.
    await consumeWebRedirectTokens();
    return;
  }

  const storedToken = await getSecureItem(GOOGLE_TOKEN_KEY);
  const refreshToken = await getSecureItem(GOOGLE_REFRESH_TOKEN_KEY);
  const storedExpiry = await getSecureItem(GOOGLE_TOKEN_EXPIRY_KEY);
  const expiresAt = Number(storedExpiry || '0');

  if (!storedToken && !refreshToken) {
    // No Drive tokens on file — the app itself is still fully usable (the
    // Supabase session is separate and unaffected), the user just won't be
    // able to sync/upload/send-to-kindle until they reconnect from Profile.
    return;
  }

  if (!expiresAt || expiresAt - Date.now() <= EXPIRY_BUFFER_MS) {
    await getValidGoogleAccessToken();
  }
}

export async function getValidGoogleAccessToken(options?: { forceRefresh?: boolean }): Promise<string> {
  const forceRefresh = options?.forceRefresh === true;
  const storedToken = await getSecureItem(GOOGLE_TOKEN_KEY);
  const storedExpiry = await getSecureItem(GOOGLE_TOKEN_EXPIRY_KEY);
  const expiresAt = Number(storedExpiry || '0');

  if (!forceRefresh && storedToken && (!expiresAt || expiresAt - Date.now() > EXPIRY_BUFFER_MS)) {
    return storedToken;
  }

  if (isWeb) {
    return refreshViaServer();
  }

  const refreshToken = await getSecureItem(GOOGLE_REFRESH_TOKEN_KEY);
  const clientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;

  if (!refreshToken || !clientId) {
    await clearGoogleAuth();
    throw new Error(`Google Drive access expired. ${RECONNECT_HINT}`);
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
      await clearGoogleAuth();
      throw new Error(`Google Drive access expired. ${RECONNECT_HINT}`);
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

// Runs the full Google OAuth consent flow (via Supabase) and stores the
// resulting Drive/Gmail provider tokens. Used both for the initial sign-in
// (LoginScreen) and to reconnect Drive access later without forcing the
// user through a full app logout (Profile screen). Resolves to false (no
// error) if the user backs out of the browser without completing sign-in.
export async function connectGoogleAccount(): Promise<boolean> {
  const configError = getSupabaseConfigError();
  if (configError) {
    throw new Error(`${configError}. Check your .env and restart Expo.`);
  }

  const googleClientId = (process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || '').trim();
  if (!googleClientId.endsWith('.apps.googleusercontent.com')) {
    throw new Error('EXPO_PUBLIC_GOOGLE_CLIENT_ID must be a Google OAuth Client ID ending with .apps.googleusercontent.com');
  }

  if (isWeb) {
    // Full-page redirect to Google and back to this site. The page unloads,
    // so this promise never meaningfully resolves; on return, supabase.ts
    // restores the session and validateGoogleSessionOnAppOpen stores tokens.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        queryParams: { access_type: 'offline', prompt: 'consent' },
        scopes: GOOGLE_SCOPES,
      },
    });
    if (error) throw new Error(error.message);
    return true;
  }

  const authSessionUri = AuthSession.makeRedirectUri({ path: 'auth' });
  const linkingUri = Linking.createURL('auth');

  // Always use the app's custom scheme — never exp:// (Expo Go), which
  // cannot handle deep link callbacks on device.
  const APP_SCHEME = 'ebooklibrary';
  let redirectUri: string;
  if (authSessionUri.startsWith(`${APP_SCHEME}://`)) {
    redirectUri = authSessionUri;
  } else if (linkingUri.startsWith(`${APP_SCHEME}://`)) {
    redirectUri = linkingUri;
  } else {
    redirectUri = `${APP_SCHEME}://auth`;
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      skipBrowserRedirect: true,
      redirectTo: redirectUri,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
      scopes: GOOGLE_SCOPES,
    },
  });

  if (error) throw new Error(error.message);
  if (!data?.url) throw new Error('Supabase did not return an OAuth URL.');

  let authUrl: URL;
  try {
    authUrl = new URL(data.url);
  } catch {
    throw new Error('Generated OAuth URL is invalid. Verify EXPO_PUBLIC_SUPABASE_URL and Auth settings.');
  }

  if (!['https:', 'http:'].includes(authUrl.protocol)) {
    throw new Error('Generated OAuth URL has an unsupported protocol.');
  }
  if (authUrl.toString().includes('undefined')) {
    throw new Error('Generated OAuth URL contains invalid parameters. Check Supabase Auth settings.');
  }

  const result = await WebBrowser.openAuthSessionAsync(authUrl.toString(), redirectUri);

  // User backed out of the browser without completing sign-in — not an
  // error, just a no-op (matches the original login flow's behavior).
  if (result.type !== 'success') {
    return false;
  }

  const hashMatches = result.url.match(/#(.*)$/);
  if (!hashMatches) {
    throw new Error('Google sign-in did not return the expected data.');
  }

  const params = new URLSearchParams(hashMatches[1]);
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  const provider_token = params.get('provider_token');
  const provider_refresh_token = params.get('provider_refresh_token');
  const expires_in = Number(params.get('expires_in') || '3300');

  if (provider_token && !provider_refresh_token) {
    throw new Error('Login succeeded, but Google refresh token was not returned. In Supabase Auth > Providers > Google, ensure offline access is enabled and re-consent with prompt=consent.');
  }

  if (provider_token) {
    await saveGoogleAuth(provider_token, expires_in, provider_refresh_token);
  }

  if (access_token && refresh_token) {
    const { error: sessionError } = await supabase.auth.setSession({ access_token, refresh_token });
    if (sessionError) throw new Error(sessionError.message);
  }

  return true;
}
