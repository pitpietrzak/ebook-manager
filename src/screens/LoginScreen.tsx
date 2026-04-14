import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Image } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '../utils/supabase';
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
      const redirectUri = AuthSession.makeRedirectUri();
      
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
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
        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUri);
        
        if (result.type === 'success') {
          const { url } = result;
          const hashMatches = url.match(/#(.*)$/);
          if (hashMatches) {
            const params = new URLSearchParams(hashMatches[1]);
            const access_token = params.get('access_token');
            const refresh_token = params.get('refresh_token');
            const provider_token = params.get('provider_token');
            
            if (provider_token) {
              await SecureStore.setItemAsync('google_provider_token', provider_token);
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
        <Text style={styles.title}>Biblioteczka Leniwców</Text>
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
