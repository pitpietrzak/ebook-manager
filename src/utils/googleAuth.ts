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

// Stores the short-lived Google access token on this device. The long-lived
// refresh token is never kept on the device — it lives server-side, held by
// the `google-token` edge function (web and mobile alike).
export async function saveGoogleAuth(providerToken: string, expiresInSeconds?: number | null) {
  await setSecureItem(GOOGLE_TOKEN_KEY, providerToken);

  const expiresAt = Date.now() + (Number(expiresInSeconds || DEFAULT_TOKEN_LIFETIME_SECONDS) * 1000);
  await setSecureItem(GOOGLE_TOKEN_EXPIRY_KEY, String(expiresAt));
}

// --- Refresh token is held by the `google-token` edge function --------------

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

// Handles the Google tokens returned by a sign-in. Requires the Supabase
// session to be set already (the edge function authenticates the user).
//
// Sign-ins don't force Google's consent screen, so Google only returns a
// refresh token the first time a user grants access; later sign-ins rely on
// the one already stored server-side. Returns 'needs-consent' when Google
// sent none and the server has none either (first sign-in, or access was
// revoked in the Google account) — the caller then re-runs the sign-in with
// the consent screen forced.
async function handleSignInProviderTokens(
  providerToken: string,
  providerRefreshToken: string | null,
  expiresInSeconds?: number | null
): Promise<'ok' | 'needs-consent'> {
  await saveGoogleAuth(providerToken, expiresInSeconds);

  if (providerRefreshToken) {
    await callGoogleTokenFunction({ action: 'store', refreshToken: providerRefreshToken });
    return 'ok';
  }

  try {
    await refreshViaServer();
    return 'ok';
  } catch (e) {
    console.warn('[googleAuth] No stored Google refresh token; consent needed.', e);
    return 'needs-consent';
  }
}

// Web: called once after the OAuth redirect lands back on the app.
const CONSENT_REDIRECT_FLAG = 'google_consent_redirect_attempted';

async function consumeWebRedirectTokens(): Promise<void> {
  const pending = takePendingWebProviderTokens();
  if (!pending?.providerToken) return;

  const consentAlreadyAttempted = sessionStorage.getItem(CONSENT_REDIRECT_FLAG) === '1';
  sessionStorage.removeItem(CONSENT_REDIRECT_FLAG);

  const outcome = await handleSignInProviderTokens(pending.providerToken, pending.providerRefreshToken);
  if (outcome === 'needs-consent' && !consentAlreadyAttempted) {
    sessionStorage.setItem(CONSENT_REDIRECT_FLAG, '1');
    await connectGoogleAccount({ forceConsent: true });
  }
}

// Mobile: versions up to 1.2.x kept the Google refresh token on the device.
// Hand it to the server once and remove it locally, so existing users keep
// their Drive access without signing in again.
let legacyMigration: Promise<void> | null = null;

function migrateLegacyRefreshToken(): Promise<void> {
  if (isWeb) return Promise.resolve();
  if (!legacyMigration) {
    legacyMigration = (async () => {
      const legacyToken = await getSecureItem(GOOGLE_REFRESH_TOKEN_KEY);
      if (!legacyToken) return;
      await callGoogleTokenFunction({ action: 'store', refreshToken: legacyToken });
      await deleteSecureItem(GOOGLE_REFRESH_TOKEN_KEY);
    })().catch((e) => {
      // Keep the local token and retry on the next app open.
      legacyMigration = null;
      console.warn('[googleAuth] Could not migrate Google refresh token to server.', e);
    });
  }
  return legacyMigration;
}

async function clearLocalGoogleAuth() {
  await Promise.all([
    deleteSecureItem(GOOGLE_TOKEN_KEY),
    deleteSecureItem(GOOGLE_REFRESH_TOKEN_KEY),
    deleteSecureItem(GOOGLE_TOKEN_EXPIRY_KEY),
  ]);
}

// Clears the Google tokens held on this device. The refresh token stored
// server-side is intentionally kept, so logging back in doesn't need Google's
// consent screen again (the google-token function's 'clear' action can remove
// it if ever needed).
export async function clearGoogleAuth() {
  await clearLocalGoogleAuth();
}

export async function validateGoogleSessionOnAppOpen(): Promise<void> {
  if (isWeb) {
    // Returning from the Google redirect: stash the new tokens. Otherwise
    // nothing to do up front — access tokens are fetched lazily on demand.
    await consumeWebRedirectTokens();
    return;
  }

  // Mobile: move a refresh token left on the device by an older version to
  // the server. Access tokens are then fetched lazily when Drive is used.
  await migrateLegacyRefreshToken();
}

export async function getValidGoogleAccessToken(options?: { forceRefresh?: boolean }): Promise<string> {
  const forceRefresh = options?.forceRefresh === true;
  const storedToken = await getSecureItem(GOOGLE_TOKEN_KEY);
  const storedExpiry = await getSecureItem(GOOGLE_TOKEN_EXPIRY_KEY);
  const expiresAt = Number(storedExpiry || '0');

  if (!forceRefresh && storedToken && (!expiresAt || expiresAt - Date.now() > EXPIRY_BUFFER_MS)) {
    return storedToken;
  }

  // Make sure an older mobile install has handed its token to the server.
  await migrateLegacyRefreshToken();
  return refreshViaServer();
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

// Runs the Google OAuth sign-in (via Supabase) and stores the resulting
// Drive/Gmail tokens. The consent screen is only forced when asked for
// (Profile > Reconnect) or when the server has no refresh token yet. Used both for the initial sign-in
// (LoginScreen) and to reconnect Drive access later without forcing the
// user through a full app logout (Profile screen). Resolves to false (no
// error) if the user backs out of the browser without completing sign-in.
export async function connectGoogleAccount(options?: { forceConsent?: boolean }): Promise<boolean> {
  const configError = getSupabaseConfigError();
  if (configError) {
    throw new Error(`${configError}. Check your .env and restart Expo.`);
  }

  const googleClientId = (process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || '').trim();
  if (!googleClientId.endsWith('.apps.googleusercontent.com')) {
    throw new Error('EXPO_PUBLIC_GOOGLE_CLIENT_ID must be a Google OAuth Client ID ending with .apps.googleusercontent.com');
  }

  if (isWeb) {
    // Full-page redirect to Google and back to this site. On return,
    // supabase.ts restores the session and validateGoogleSessionOnAppOpen
    // stores the tokens. The consent screen is only forced when asked for
    // (Profile > Reconnect, or when the server has no refresh token yet).
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        queryParams: options?.forceConsent
          ? { access_type: 'offline', prompt: 'consent' }
          : { access_type: 'offline' },
        scopes: GOOGLE_SCOPES,
      },
    });
    if (error) throw new Error(error.message);
    // The page is navigating away — report "not completed" so callers don't
    // show a success message for a flow that finishes after the redirect.
    return false;
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
      queryParams: options?.forceConsent
        ? { access_type: 'offline', prompt: 'consent' }
        : { access_type: 'offline' },
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

  // Session first: the google-token edge function needs the signed-in user.
  if (access_token && refresh_token) {
    const { error: sessionError } = await supabase.auth.setSession({ access_token, refresh_token });
    if (sessionError) throw new Error(sessionError.message);
  }

  if (provider_token) {
    const outcome = await handleSignInProviderTokens(provider_token, provider_refresh_token, expires_in);
    if (outcome === 'needs-consent') {
      if (!options?.forceConsent) {
        // First sign-in (or access revoked): go through Google's consent
        // screen once to obtain a refresh token.
        return connectGoogleAccount({ forceConsent: true });
      }
      console.warn('[googleAuth] Google returned no refresh token even with consent.');
    }
  }

  return true;
}
