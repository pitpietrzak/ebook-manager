import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, SafeAreaView, ScrollView } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useProfile } from '../contexts/ProfileContext';
import { supabase } from '../utils/supabase';
import { User, LogOut, Moon, Sun, Edit3, Bell, Shield, LayoutGrid, List } from 'lucide-react-native';

export default function ProfileScreen() {
  const { colors, isDark, toggleTheme, viewMode, toggleViewMode } = useTheme();
  const { profile, updateDisplayName } = useProfile();
  const styles = getStyles(colors, isDark);

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) Alert.alert('Error', error.message);
  };

  const handleEditName = () => {
    Alert.prompt(
      'Edit Display Name',
      'Enter your new display name',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Save', onPress: (name) => name && updateDisplayName(name) }
      ],
      'plain-text',
      profile?.display_name
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.avatarContainer}>
            <User size={40} color={colors.primary} />
          </View>
          <Text style={styles.name}>{profile?.display_name || 'Generic Sloth'}</Text>
          <Text style={styles.email}>{profile?.email}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Preferences</Text>
          
          <TouchableOpacity style={styles.row} onPress={handleEditName}>
            <View style={styles.rowLeft}>
              <View style={[styles.iconBox, { backgroundColor: colors.primary + '11' }]}>
                <Edit3 size={20} color={colors.primary} />
              </View>
              <Text style={styles.rowLabel}>Display Name</Text>
            </View>
            <Text style={styles.rowValue}>{profile?.display_name}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.row} onPress={toggleTheme}>
            <View style={styles.rowLeft}>
              <View style={[styles.iconBox, { backgroundColor: colors.accent + '11' }]}>
                {isDark ? <Sun size={20} color={colors.accent} /> : <Moon size={20} color={colors.accent} />}
              </View>
              <Text style={styles.rowLabel}>{isDark ? 'Light Mode' : 'Dark Mode'}</Text>
            </View>
            <View style={[styles.toggle, isDark && styles.toggleActive]}>
              <View style={[styles.toggleDot, isDark && styles.toggleDotActive]} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.row} onPress={toggleViewMode}>
            <View style={styles.rowLeft}>
              <View style={[styles.iconBox, { backgroundColor: colors.primary + '11' }]}>
                {viewMode === 'grid' ? <List size={20} color={colors.primary} /> : <LayoutGrid size={20} color={colors.primary} />}
              </View>
              <Text style={styles.rowLabel}>{viewMode === 'grid' ? 'Switch to List' : 'Switch to Grid'}</Text>
            </View>
            <View style={[styles.toggle, viewMode === 'list' && styles.toggleActive]}>
              <View style={[styles.toggleDot, viewMode === 'list' && styles.toggleDotActive]} />
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          
          <TouchableOpacity style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={[styles.iconBox, { backgroundColor: '#FFD70011' }]}>
                <Bell size={20} color="#FFD700" />
              </View>
              <Text style={styles.rowLabel}>Notifications</Text>
            </View>
            <Text style={styles.rowValue}>Enabled</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={[styles.iconBox, { backgroundColor: '#4CAF5011' }]}>
                <Shield size={20} color="#4CAF50" />
              </View>
              <Text style={styles.rowLabel}>Privacy</Text>
            </View>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <LogOut size={20} color="#F44336" style={{ marginRight: 10 }} />
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>

        <Text style={styles.footerText}>Biblioteczka Leniwców v1.1.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors: any, isDark: boolean) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  avatarContainer: {
    width: 80, height: 80,
    borderRadius: 40,
    backgroundColor: colors.card,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 16,
    borderWidth: 2, borderColor: colors.primary + '33',
  },
  name: {
    fontSize: 24, fontWeight: '700', color: colors.text, marginBottom: 4,
  },
  email: {
    fontSize: 14, color: colors.textSecondary,
  },
  section: {
    marginBottom: 24,
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1, borderColor: colors.border,
  },
  sectionTitle: {
    fontSize: 13, fontWeight: '700', color: colors.primary,
    textTransform: 'uppercase', letterSpacing: 1,
    marginBottom: 16, marginLeft: 4,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12,
  },
  rowLeft: {
    flexDirection: 'row', alignItems: 'center',
  },
  iconBox: {
    width: 36, height: 36, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center',
    marginRight: 12,
  },
  rowLabel: {
    fontSize: 16, color: colors.text, fontWeight: '500',
  },
  rowValue: {
    fontSize: 14, color: colors.textSecondary,
  },
  toggle: {
    width: 44, height: 24, borderRadius: 12,
    backgroundColor: isDark ? '#3A2552' : '#E0E0E0',
    padding: 2,
  },
  toggleActive: {
    backgroundColor: colors.primary,
  },
  toggleDot: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: '#fff',
  },
  toggleDotActive: {
    transform: [{ translateX: 20 }],
  },
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 16, borderRadius: 20,
    backgroundColor: isDark ? '#F4433611' : '#F4433608',
    marginTop: 8,
  },
  logoutText: {
    fontSize: 16, fontWeight: '700', color: '#F44336',
  },
  footerText: {
    textAlign: 'center', color: colors.textSecondary, fontSize: 12, marginTop: 40,
  }
});
