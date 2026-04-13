import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Session } from '@supabase/supabase-js';
import { supabase } from './src/utils/supabase';

// Screens
import LoginScreen from './src/screens/LoginScreen';
import CollectionsScreen from './src/screens/CollectionsScreen';
import LibraryScreen from './src/screens/LibraryScreen';
import BookDetailScreen from './src/screens/BookDetailScreen';

export type RootStackParamList = {
  Login: undefined;
  Collections: undefined;
  Library: { collectionFilter: string | null, autoFocusSearch?: boolean };
  BookDetail: { bookId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';
import { ProfileProvider } from './src/contexts/ProfileContext';
import { DefaultTheme, DarkTheme } from '@react-navigation/native';

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
            <Stack.Screen name="Collections" component={CollectionsScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Library" component={LibraryScreen} options={({ route }) => ({
              title: route.params?.collectionFilter === '__uncategorised__'
                ? 'Uncategorised'
                : route.params?.collectionFilter ?? 'All Books',
            })} />
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
