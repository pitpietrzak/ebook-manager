import React, { useEffect, useState } from 'react';
import { NavigationContainer, NavigatorScreenParams } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Session } from '@supabase/supabase-js';
import { Platform, StatusBar } from 'react-native';
import { getSupabaseConfigError, supabase } from './src/utils/supabase';

if (Platform.OS === 'android') {
  StatusBar.setTranslucent(false);
}

// Screens
import LoginScreen from './src/screens/LoginScreen';
import CollectionsScreen from './src/screens/CollectionsScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import LibraryScreen from './src/screens/LibraryScreen';
import BookDetailScreen from './src/screens/BookDetailScreen';

type LibraryRouteParams = {
  collectionFilter?: string | null;
  autoFocusSearch?: boolean;
};

export type RootStackParamList = {
  Login: undefined;
  Main: undefined; // Tab Navigator
  BookDetail: { bookId: string };
};

export type LibraryStackParamList = {
  LibraryHome: LibraryRouteParams | undefined;
  LibraryCatalog: { collectionFilter: string | null; autoFocusSearch?: boolean };
};

export type TabParamList = {
  Dashboard: undefined;
  Library: NavigatorScreenParams<LibraryStackParamList> | undefined;
  Profile: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();
const LibraryStack = createNativeStackNavigator<LibraryStackParamList>();

import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';
import { ProfileProvider } from './src/contexts/ProfileContext';
import { VersionProvider } from './src/contexts/VersionContext';
import { DefaultTheme, DarkTheme } from '@react-navigation/native';
import { LayoutDashboard, BookOpen, User as UserIcon } from 'lucide-react-native';
import { validateGoogleSessionOnAppOpen } from './src/utils/googleAuth';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';

// Additional Screen
import ProfileScreen from './src/screens/ProfileScreen';

function LibraryNavigator() {
  return (
    <LibraryStack.Navigator screenOptions={{ headerShown: false, gestureEnabled: true }}>
      <LibraryStack.Screen
        name="LibraryHome"
        component={LibraryScreen}
        initialParams={{ collectionFilter: null }}
      />
      <LibraryStack.Screen name="LibraryCatalog" component={LibraryScreen} />
    </LibraryStack.Navigator>
  );
}

function TabNavigator() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        sceneContainerStyle: { paddingBottom: 0 },
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          height: 60 + Math.max(insets.bottom, 0),
          paddingBottom: Math.max(insets.bottom, 12),
          paddingTop: 6,
        },
        tabBarItemStyle: { paddingVertical: 2 },
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
      <Tab.Screen name="Library" component={LibraryNavigator} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

// Set up notification handlers at app bootstrap
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function AppContent() {
  const [session, setSession] = useState<Session | null>(null);
  const { colors, isDark } = useTheme();
  const supabaseConfigError = getSupabaseConfigError();

  // Set up notification event listeners
  useEffect(() => {
    // Handle notification received in foreground
    const foregroundSubscription = Notifications.addNotificationReceivedListener(
      (_notification) => {
        // Notification will be shown by setNotificationHandler
      }
    );

    // Handle notification tap
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        console.log('Notification response:', response.notification);
        // Optional: navigate to relevant screen based on notification data
      }
    );

    return () => {
      foregroundSubscription.remove();
      responseSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (supabaseConfigError) {
      setSession(null);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [supabaseConfigError]);

  useEffect(() => {
    if (!session?.user) return;

    validateGoogleSessionOnAppOpen().catch(() => {
      // signOut is handled inside the auth helper
    });
  }, [session?.user?.id]);

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
    <SafeAreaProvider>
      <ThemeProvider>
        <VersionProvider>
          <ProfileProvider>
            <AppContent />
          </ProfileProvider>
        </VersionProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
