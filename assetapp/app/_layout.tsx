// NOTE: as of SDK 56 expo-router no longer supports react-navigation. Importing
// `@react-navigation/native` here (even just for theming) makes the production
// bundle fail with "expo-router is no longer compatible with react-navigation".
// expo-router re-exports its own vendored DarkTheme/DefaultTheme/ThemeProvider,
// so the theming behaviour is identical.
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import "react-native-reanimated";

import { useColorScheme } from "@/hooks/use-color-scheme";
import { fetchActorProfile, isInactiveStatus, isOfficeOnlyRoute, isOfficeRole } from "@/lib/access";
import { enrichUserWithEmployeeData } from "@/lib/userService";

export const unstable_settings = {
  initialRouteName: "login",
};

// Routes a signed-out visitor is allowed to open. Anything else gets bounced
// back to /login by the guard below — including the forgot-password wizard,
// which was the reason tapping "Forgot Password?" flashed the reset screen and
// then landed straight back on the login page.
const PUBLIC_ROUTES = ["login", "register", "forgot-password"];

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const segments = useSegments();
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  // The live account check runs once per app launch, not on every navigation:
  // the stored session is what keeps the app usable offline, and privileged
  // actions re-read the account from the database anyway (`lib/access.ts`).
  const verifiedSession = useRef(false);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const userJson = await AsyncStorage.getItem('user');
        const isPublicRoute = PUBLIC_ROUTES.includes(segments[0] as string);

        if (!userJson) {
          if (!isPublicRoute) {
            router.replace('/login');
          }
          return;
        }

        const user = JSON.parse(userJson);

        // A session written at sign-in can outlive the account it names: the
        // office may have deactivated or deleted it since. The web's
        // `EnforceActiveAccount` middleware asks the database on every request;
        // the phone asks once at launch and then ends the session instead of
        // letting a deactivated account keep browsing with stale permissions.
        if (!verifiedSession.current) {
          verifiedSession.current = true;
          let live: Awaited<ReturnType<typeof fetchActorProfile>> | undefined;
          try {
            live = await fetchActorProfile(user.id ?? user.user_id ?? null);
          } catch {
            // Offline: keep the stored session rather than locking the user out
            // of an app that is meant to keep working without a connection.
            live = undefined;
          }

          if (live === null) {
            await AsyncStorage.removeItem('user');
            router.replace('/login');
            return;
          }

          if (live && isInactiveStatus(live.status)) {
            await AsyncStorage.removeItem('user');
            router.replace({ pathname: '/login', params: { reason: 'deactivated' } } as any);
            return;
          }

          if (live) {
            // Refresh the cached role/status (and, best effort, the name and
            // department) so a change made on the web is visible straight away.
            const enriched = await enrichUserWithEmployeeData({
              ...user,
              role: live.role || user.role,
              status: live.status || user.status,
            });
            await AsyncStorage.setItem('user', JSON.stringify(enriched));
            Object.assign(user, enriched);
          }
        }

        if (isPublicRoute) {
          // Web parity: the Asset Management Office (Admin) goes to the office
          // area, everyone else to the employee area.
          const target = isOfficeRole(user.role) ? '/(tabs)' : '/(user-tabs)';
          router.replace(target);
          return;
        }

        // The office-area tab group is the admin area. A non-office account that
        // deep-links into it is sent back to its own area, the same way the
        // web's admin middleware refuses the request instead of rendering it.
        if (segments[0] === '(tabs)' && !isOfficeRole(user.role)) {
          router.replace('/(user-tabs)' as any);
          return;
        }

        // Standalone office screens (`/reports`, `/transfer`, `/repair`, …) are
        // not inside the tab group, so the check above never covered them. A
        // non-office account that deep-links to one is sent back to its own
        // area instead of rendering an office screen.
        if (isOfficeOnlyRoute(segments[0]) && !isOfficeRole(user.role)) {
          router.replace('/(user-tabs)' as any);
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
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1E3A5F' }}>
        <ActivityIndicator size="large" color="#FDB833" />
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="register" />
        <Stack.Screen name="forgot-password" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(user-tabs)" />
        <Stack.Screen name="submit-request" />
        <Stack.Screen name="request-detail" />
        <Stack.Screen name="modal" options={{ presentation: "modal", title: "Modal" }} />
        <Stack.Screen name="asset-registry" />
        <Stack.Screen name="transfer" />
        <Stack.Screen name="archived-disposals" />
        <Stack.Screen name="activity-log" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="maintenance" />
        <Stack.Screen name="lifespan" />
        <Stack.Screen name="reports" />
        <Stack.Screen name="accounts" />
        <Stack.Screen name="age-review" />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}