import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from '../utils/supabase';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Alert, Platform } from 'react-native';

type Profile = {
  id: string;
  display_name: string;
  avatar_url?: string;
  email: string;
  is_admin?: boolean;
  notifications_enabled: boolean;
  kindle_email?: string;
};

interface ProfileContextType {
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  updateDisplayName: (name: string) => Promise<void>;
  setNotificationsEnabled: (enabled: boolean) => Promise<void>;
  updateKindleEmail: (email: string) => Promise<void>;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export const ProfileProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const processedNotificationsForUserRef = useRef<string | null>(null);

  const processExistingNotifications = async (userId: string) => {
    if (processedNotificationsForUserRef.current === userId) {
      return;
    }

    processedNotificationsForUserRef.current = userId;

    try {
      const { data, error } = await supabase.functions.invoke('process-existing-notifications', {
        body: { user_id: userId },
      });

      if (error) {
        console.error('[Push] process-existing-notifications invoke error:', error);
      } else {
        console.log('[Push] process-existing-notifications invoked:', data);
      }
    } catch (e) {
      console.error('[Push] Error invoking process-existing-notifications:', e);
    }
  };

  useEffect(() => {
    fetchProfile();
    registerForPushNotificationsAsync();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        setProfile(null);
        setLoading(false);
        return;
      }

      fetchProfile();
      processExistingNotifications(session.user.id);
      // Re-register push token after login to ensure it's always fresh
      registerForPushNotificationsAsync();
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const fetchProfile = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setProfile(null);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      const fallbackDisplayName =
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        (user.email ? user.email.split('@')[0] : '');

      const nextProfile: Profile = {
        id: user.id,
        email: user.email || '',
        display_name: data?.display_name?.trim() || fallbackDisplayName,
        avatar_url: data?.avatar_url || user.user_metadata?.avatar_url || user.user_metadata?.picture,
        is_admin: data?.is_admin,
        notifications_enabled: data?.notifications_enabled ?? true,
        kindle_email: data?.kindle_email,
      };

      await supabase
        .from('profiles')
        .upsert({
          id: nextProfile.id,
          email: nextProfile.email,
          display_name: nextProfile.display_name,
          avatar_url: nextProfile.avatar_url,
          notifications_enabled: nextProfile.notifications_enabled,
          kindle_email: nextProfile.kindle_email,
        });

      setProfile(nextProfile);
      processExistingNotifications(user.id);
    } catch (e) {
      console.error('Error fetching profile:', e);
    } finally {
      setLoading(false);
    }
  };

  const refreshProfile = async () => {
    await fetchProfile();
  };

  const updateDisplayName = async (name: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('profiles')
        .upsert({ 
          id: user.id, 
          display_name: name,
          email: user.email // Ensure email is saved if this is an insert
        });

      if (error) throw error;
      
      // Update local state
      if (profile) {
        setProfile({ ...profile, display_name: name });
      } else {
        setProfile({ id: user.id, display_name: name, email: user.email || '', notifications_enabled: true });
      }
    } catch (e) {
      console.error('Error updating display name:', e);
      throw e;
    }
  };
  
  const setNotificationsEnabled = async (enabled: boolean) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from('profiles')
        .upsert({ 
          id: user.id, 
          notifications_enabled: enabled,
          email: user.email // Ensure email is saved if this is an insert
        });

      if (error) throw error;
      if (profile) setProfile({ ...profile, notifications_enabled: enabled });
    } catch (e) {
      console.error('Error setting notifications preference:', e);
      throw e;
    }
  };

  const updateKindleEmail = async (email: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('profiles')
        .upsert({ 
          id: user.id, 
          kindle_email: email,
          email: user.email 
        });

      if (error) throw error;
      if (profile) setProfile({ ...profile, kindle_email: email });
    } catch (e) {
      console.error('Error updating Kindle email:', e);
      throw e;
    }
  };

  const registerForPushNotificationsAsync = async () => {
    if (!Device.isDevice) {
      console.log('[Push] Skipping registration: physical device required');
      return;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      console.log('[Push] Permission not granted, skipping token registration');
      return;
    }

    const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
    if (!projectId) {
      console.log('[Push] Project ID not found, skipping token registration');
      return;
    }

    try {
      const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      console.log('[Push] Token registered');

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from('profiles')
          .update({ push_token: token })
          .eq('id', user.id);

        processExistingNotifications(user.id);
      } else {
        console.log('[Push] No authenticated user, skipping profile token update');
      }
    } catch (e) {
      console.error('[Push] Error getting push token:', e);
    }
  };

  return (
    <ProfileContext.Provider value={{ profile, loading, refreshProfile, updateDisplayName, setNotificationsEnabled, updateKindleEmail }}>
      {children}
    </ProfileContext.Provider>
  );
};

export const useProfile = () => {
  const context = useContext(ProfileContext);
  if (context === undefined) {
    throw new Error('useProfile must be used within a ProfileProvider');
  }
  return context;
};
