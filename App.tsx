import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Session } from '@supabase/supabase-js';
import { supabase } from './src/utils/supabase';

// Screens
import LoginScreen from './src/screens/LoginScreen';
import CollectionsScreen from './src/screens/CollectionsScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import LibraryScreen from './src/screens/LibraryScreen';
import BookDetailScreen from './src/screens/BookDetailScreen';

export type RootStackParamList = {
  Login: undefined;
  Main: undefined; // Tab Navigator
  BookDetail: { bookId: string };
};

export type TabParamList = {
  Dashboard: undefined;
  Library: { collectionFilter: string | null, autoFocusSearch?: boolean };
  Profile: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';
import { ProfileProvider } from './src/contexts/ProfileContext';
import { DefaultTheme, DarkTheme } from '@react-navigation/native';
import { LayoutDashboard, BookOpen, User as UserIcon } from 'lucide-react-native';

// Additional Screen
import ProfileScreen from './src/screens/ProfileScreen';

function TabNavigator() {
  const { colors, isDark } = useTheme();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          height: 64,
          paddingBottom: 10,
          paddingTop: 10,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarIcon: ({ color, size }) => {
          if (route.name === 'Dashboard') return <LayoutDashboard size={size} color={color} />;
          if (route.name === 'Library') return <BookOpen size={size} color={color} />;
          if (route.name === 'Profile') return <UserIcon size={size} color={color} />;
          return null;
        },
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen name="Library" component={LibraryScreen} initialParams={{ collectionFilter: null }} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

function AppContent() {
  const [session, setSession] = useState<Session | null>(null);
  const { colors, isDark } = useTheme();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
  }, []);

  const navTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
      background: colors.background,
      card: colors.headerBg,
      text: colors.text,
      border: colors.border,
    },
  };

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.headerBg },
          headerTintColor: colors.primary,
          headerTitleStyle: { fontWeight: '700', color: colors.text },
        }}
      >
        {session && session.user ? (
          <>
            <Stack.Screen name="Main" component={TabNavigator} options={{ headerShown: false }} />
            <Stack.Screen name="BookDetail" component={BookDetailScreen} options={{ title: 'Book Details' }} />
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ProfileProvider>
        <AppContent />
      </ProfileProvider>
    </ThemeProvider>
  );
}
