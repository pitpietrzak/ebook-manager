import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme } from 'react-native';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  isDark: boolean;
  viewMode: 'grid' | 'list';
  toggleTheme: () => void;
  toggleViewMode: () => void;
  colors: typeof LightColors;
}

const LightColors = {
  background: '#FDF8FF',
  card: '#FFFFFF',
  text: '#1A1A2E',
  textSecondary: '#666666',
  primary: '#531492', // PURPLE_MAIN
  accent: '#E80F88',  // PINK_ACCENT
  border: '#E0E0E0',
  menuBg: '#FFFFFF',
  menuItemText: '#333333',
  inputBg: '#F5F5F5',
  headerBg: '#FFFFFF',
};

const DarkColors = {
  background: '#120B1E',
  card: '#1D122B',
  text: '#E0E0E0',
  textSecondary: '#A0A0A0',
  primary: '#BB86FC', // Electric Violet
  accent: '#FF75D8',  // Neon Pink
  border: '#3A2552',
  menuBg: '#1D122B',
  menuItemText: '#E0E0E0',
  inputBg: '#120B1E',
  headerBg: '#1D122B',
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const systemScheme = useColorScheme();
  const [theme, setTheme] = useState<Theme>(systemScheme === 'dark' ? 'dark' : 'light');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  useEffect(() => {
    loadTheme();
    loadViewMode();
  }, []);

  const loadTheme = async () => {
    try {
      const savedTheme = await AsyncStorage.getItem('user_theme');
      if (savedTheme) setTheme(savedTheme as Theme);
    } catch (e) {
      console.log('Failed to load theme:', e);
    }
  };
  
  const loadViewMode = async () => {
    try {
      const savedMode = await AsyncStorage.getItem('user_view_mode');
      if (savedMode) setViewMode(savedMode as 'grid' | 'list');
    } catch (e) {
      console.log('Failed to load view mode:', e);
    }
  };

  const toggleTheme = async () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    try {
      await AsyncStorage.setItem('user_theme', newTheme);
    } catch (e) {
      console.log('Failed to save theme:', e);
    }
  };

  const toggleViewMode = async () => {
    const newMode = viewMode === 'grid' ? 'list' : 'grid';
    setViewMode(newMode);
    try {
      await AsyncStorage.setItem('user_view_mode', newMode);
    } catch (e) {
      console.log('Failed to save view mode:', e);
    }
  };

  const colors = theme === 'light' ? LightColors : DarkColors;
  const isDark = theme === 'dark';

  return (
    <ThemeContext.Provider value={{ theme, isDark, viewMode, toggleTheme, toggleViewMode, colors }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
