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

export default function App() {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
  }, []);

  return (
    <NavigationContainer>
      <Stack.Navigator>
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
