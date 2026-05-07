import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Image } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import * as Linking from 'expo-linking';
import { getSupabaseConfigError, supabase } from '../utils/supabase';
import { saveGoogleAuth } from '../utils/googleAuth';
import { useTheme } from '../contexts/ThemeContext';
import { StatusBar } from 'react-native';

import { LogIn } from 'lucide-react-native';

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors, isDark);

  const handleGoogleLogin = async () => {
    // ... logic remains same ...
    try {
      setLoading(true);

      const configError = getSupabaseConfigError();
      if (configError) {
        throw new Error(`${configError}. Check your .env and restart Expo.`);
      }

      const googleClientId = (process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || '').trim();
      if (!googleClientId.endsWith('.apps.googleusercontent.com')) {
        throw new Error('EXPO_PUBLIC_GOOGLE_CLIENT_ID must be a Google OAuth Client ID ending with .apps.googleusercontent.com');
      }

      const authSessionUri = AuthSession.makeRedirectUri({ path: 'auth' });
      const linkingUri = Linking.createURL('auth');
      console.log('[Login] authSessionUri:', authSessionUri);
      console.log('[Login] linkingUri:', linkingUri);

      // Always use the app's custom scheme — never exp:// (Expo Go)
      // exp:// cannot handle deep link callbacks on device
      const APP_SCHEME = 'ebooklibrary';
      let redirectUri: string;
      if (authSessionUri.startsWith(`${APP_SCHEME}://`)) {
        redirectUri = authSessionUri;
      } else if (linkingUri.startsWith(`${APP_SCHEME}://`)) {
        redirectUri = linkingUri;
      } else {
        // Fallback: construct directly from scheme
        redirectUri = `${APP_SCHEME}://auth`;
        console.warn('[Login] Neither URI uses app scheme, falling back to:', redirectUri);
      }
      console.log('[Login] Using redirectUri:', redirectUri);
      
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          skipBrowserRedirect: true,
          redirectTo: redirectUri,
          queryParams: {
            access_type: 'offline', 
            prompt: 'consent',
          },
          scopes: 'openid profile email https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/gmail.send',
        },
      });

      if (error) {
        Alert.alert('Error', error.message);
        setLoading(false);
        return;
      }

      if (data?.url) {
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
        
        if (result.type === 'success') {
          const { url } = result;
          const hashMatches = url.match(/#(.*)$/);
          if (hashMatches) {
            const params = new URLSearchParams(hashMatches[1]);
            const access_token = params.get('access_token');
            const refresh_token = params.get('refresh_token');
            const provider_token = params.get('provider_token');
            const provider_refresh_token = params.get('provider_refresh_token');
            const expires_in = Number(params.get('expires_in') || '3300');

            if (provider_token && !provider_refresh_token) {
              Alert.alert(
                'Google OAuth setup issue',
                'Login succeeded, but Google refresh token was not returned. In Supabase Auth > Providers > Google, ensure offline access is enabled and re-consent with prompt=consent.'
              );
            }
            
            if (provider_token) {
              await saveGoogleAuth(provider_token, expires_in, provider_refresh_token);
            }
            
            if (access_token && refresh_token) {
              const { error: sessionError } = await supabase.auth.setSession({
                access_token,
                refresh_token,
              });
              
              if (sessionError) {
                 Alert.alert('Session Error', sessionError.message);
              }
            }
          }
        }
      }

      if (!data?.url) {
        throw new Error('Supabase did not return an OAuth URL.');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
      
      <View style={styles.hero}>
        <View style={styles.iconContainer}>
          <Image 
            source={require('../../assets/sloth-logo.png')} 
            style={styles.logo}
            resizeMode="contain"
          />
        </View>
        <Text style={styles.title}>Biblioteczka Leniwcow</Text>
        <Text style={styles.subtitle}>Your stories, shared & organized.</Text>
      </View>

      <TouchableOpacity 
        style={[styles.button, loading && styles.buttonDisabled]} 
        disabled={loading}
        onPress={handleGoogleLogin}
        activeOpacity={0.8}
      >
        <View style={styles.btnContent}>
          <LogIn size={20} color="#fff" style={{ marginRight: 12 }} />
          <Text style={styles.buttonText}>
            {loading ? 'Connecting...' : 'Continue with Google'}
          </Text>
        </View>
      </TouchableOpacity>
      
      <Text style={styles.footer}>Powered by Supabase & Google Drive</Text>
    </View>
  );
}

const getStyles = (colors: any, isDark: boolean) => StyleSheet.create({
  container: {
    flex: 1,
    padding: 30,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hero: {
    alignItems: 'center',
    marginBottom: 60,
  },
  iconContainer: {
    width: 130, height: 130,
    borderRadius: 40,
    backgroundColor: colors.card,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 24,
    borderWidth: 1, borderColor: colors.border,
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15, shadowRadius: 20, elevation: 8,
    overflow: 'hidden',
  },
  logo: {
    width: '100%',
    height: '100%',
  },
  title: {
    fontSize: 34,
    fontWeight: '900',
    color: colors.primary,
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },
  button: {
    backgroundColor: colors.primary,
    paddingVertical: 18,
    borderRadius: 20,
    width: '100%',
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 10, elevation: 8,
  },
  btnContent: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 17,
  },
  footer: {
    position: 'absolute', bottom: 40,
    fontSize: 12, color: colors.textSecondary, fontWeight: '500',
  }
});
