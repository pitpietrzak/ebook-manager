import React, { createContext, useContext, useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { showAlert } from '../utils/alert';
import Constants from 'expo-constants';
import { supabase } from '../utils/supabase';

type SystemVersion = {
  id: string;
  platform: 'ios' | 'android';
  version: string;
  download_url: string;
  release_notes?: string;
  is_required: boolean;
};

interface VersionContextType {
  currentVersion: string;
  latestVersion: SystemVersion | null;
  hasUpdateAvailable: boolean;
  checkForUpdates: (silent?: boolean) => Promise<void>;
}

const VersionContext = createContext<VersionContextType | undefined>(undefined);

const compareVersions = (current: string, latest: string): number => {
  const parseVersion = (v: string) => {
    const parts = v.split('.').map((x) => parseInt(x, 10));
    return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
  };

  const curr = parseVersion(current);
  const lat = parseVersion(latest);

  if (lat.major > curr.major) return 1;
  if (lat.major < curr.major) return -1;
  if (lat.minor > curr.minor) return 1;
  if (lat.minor < curr.minor) return -1;
  if (lat.patch > curr.patch) return 1;
  if (lat.patch < curr.patch) return -1;
  return 0;
};

export const VersionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const currentVersion = Constants.expoConfig?.version || '1.0.0';
  const [latestVersion, setLatestVersion] = useState<SystemVersion | null>(null);
  const [hasUpdateAvailable, setHasUpdateAvailable] = useState(false);

  const checkForUpdates = async (silent = true) => {
    // The web build is always the latest deploy — nothing to update.
    if (Platform.OS === 'web') {
      if (!silent) showAlert('Up to Date', `You're using the web app, which is always the latest version.`);
      return;
    }

    try {
      const platform = Platform.OS === 'ios' ? 'ios' : 'android';

      const { data, error } = await supabase
        .from('system_versions')
        .select('*')
        .eq('platform', platform)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.warn('Error fetching version info:', error);
        return;
      }

      if (data) {
        setLatestVersion(data);
        const isNewer = compareVersions(currentVersion, data.version) > 0;
        setHasUpdateAvailable(isNewer);

        if (isNewer) {
          const isRequired = data.is_required;
          const message = isRequired
            ? `A critical update to v${data.version} is available. You must update to continue.\n\n${data.release_notes || ''}`
            : `A new version v${data.version} is available!\n\n${data.release_notes || 'Update now to get the latest features and fixes.'}`;

          showAlert(
            isRequired ? 'Update Required' : 'Update Available',
            message,
            isRequired
              ? [
                  {
                    text: 'Update Now',
                    onPress: async () => {
                      const canOpen = await Linking.canOpenURL(data.download_url);
                      if (canOpen) {
                        await Linking.openURL(data.download_url);
                      }
                    },
                  },
                ]
              : [
                  {
                    text: 'Later',
                    style: 'cancel',
                  },
                  {
                    text: 'Update',
                    onPress: async () => {
                      const canOpen = await Linking.canOpenURL(data.download_url);
                      if (canOpen) {
                        await Linking.openURL(data.download_url);
                      }
                    },
                  },
                ]
          );
        } else if (!silent) {
          showAlert('Up to Date', `You're running the latest version (v${currentVersion}).`);
        }
      } else if (!silent) {
        showAlert('Up to Date', `You're running the latest version (v${currentVersion}).`);
      }
    } catch (e) {
      console.warn('Version check failed:', e);
    }
  };

  useEffect(() => {
    checkForUpdates(true);
  }, []);

  return (
    <VersionContext.Provider value={{ currentVersion, latestVersion, hasUpdateAvailable, checkForUpdates }}>
      {children}
    </VersionContext.Provider>
  );
};

export const useVersion = () => {
  const context = useContext(VersionContext);
  if (context === undefined) {
    throw new Error('useVersion must be used within a VersionProvider');
  }
  return context;
};
