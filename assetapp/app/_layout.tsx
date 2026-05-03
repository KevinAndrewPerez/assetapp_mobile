import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import "react-native-reanimated";

import { useColorScheme } from "@/hooks/use-color-scheme";

export const unstable_settings = {
  initialRouteName: "login",
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const segments = useSegments();
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const userJson = await AsyncStorage.getItem('user');
        const inAuthGroup = segments[0] === 'login' || segments[0] === 'register';

        if (!userJson) {
          if (!inAuthGroup) {
            router.replace('/login');
          }
        } else if (inAuthGroup) {
          const user = JSON.parse(userJson);
          const target = (user.role === 'Admin' || user.role === 'AssetOfficer') 
            ? '/(tabs)' 
            : '/(user-tabs)';
          router.replace(target);
        }
      } catch (e) {
        console.error("Auth Guard Error:", e);
      } finally {
        setIsReady(true);
      }
    };

    checkAuth();
  }, [segments, isReady]); 

  // Prevent "flickering" while the app checks AsyncStorage
  if (!isReady) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a3a5c' }}>
        <ActivityIndicator size="large" color="#f4b942" />
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="register" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(user-tabs)" />
        <Stack.Screen name="submit-request" />
        <Stack.Screen name="modal" options={{ presentation: "modal", title: "Modal" }} />
        <Stack.Screen name="assets" />
        <Stack.Screen name="asset-registry" />
        <Stack.Screen name="activity-log" />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}