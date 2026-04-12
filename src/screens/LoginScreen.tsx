import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '../utils/supabase';

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const [loading, setLoading] = useState(false);

  const handleGoogleLogin = async () => {
    try {
      setLoading(true);
      const redirectUri = AuthSession.makeRedirectUri();
      
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUri,
          queryParams: {
            access_type: 'offline', // Need this to get refresh tokens sometimes
            prompt: 'consent',
          },
          scopes: 'openid profile email https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly',
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
          // Parse the hash parameters from the returned redirect URL
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
      <Text style={styles.title}>Biblioteczka Leniwców 🦥</Text>
      <Text style={styles.subtitle}>Log in slowly to your shared library...</Text>

      <TouchableOpacity 
        style={styles.button} 
        disabled={loading}
        onPress={handleGoogleLogin}
      >
        <Text style={styles.buttonText}>
          {loading ? 'Signing In...' : 'Sign in with Google'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#FDF8FF',
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#531492',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#A155B9',
    marginBottom: 40,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#531492',
    padding: 15,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#a0c1f9',
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  warning: {
    color: 'red',
    marginTop: 20,
    textAlign: 'center',
  }
});
