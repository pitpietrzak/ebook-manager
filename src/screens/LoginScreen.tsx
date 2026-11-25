import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { showAlert } from '../utils/alert';
import { connectGoogleAccount } from '../utils/googleAuth';
import { useTheme } from '../contexts/ThemeContext';
import { StatusBar } from 'react-native';

import { LogIn } from 'lucide-react-native';

export default function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors, isDark);

  const handleGoogleLogin = async () => {
    try {
      setLoading(true);
      await connectGoogleAccount();
    } catch (e: any) {
      showAlert('Error', e.message);
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
