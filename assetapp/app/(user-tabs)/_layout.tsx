import { Tabs } from "expo-router";
import React, { useRef, useEffect } from "react";
import { View, StyleSheet, Platform, Animated } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

import { HapticTab } from "@/components/haptic-tab";

function AnimatedTabIcon({ name, color, focused, size = 24 }: { name: string; color: string; focused: boolean; size?: number }) {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.spring(scale, {
      toValue: focused ? 1.28 : 1,
      useNativeDriver: true,
      tension: 120,
      friction: 7,
    }).start();
  }, [focused, scale]);

  return (
    <Animated.View style={[styles.iconWrap, { transform: [{ scale }] }]}>
      <MaterialCommunityIcons name={name as any} size={size} color={color} />
    </Animated.View>
  );
}

export default function UserLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#0C134F",
        tabBarInactiveTintColor: "rgba(12, 19, 79, 0.55)",
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarShowLabel: false,
        tabBarButton: HapticTab,
        tabBarBackground: () => (
          <LinearGradient
            colors={['#FDB833', '#F59E0B']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        ),
        tabBarStyle: {
          backgroundColor: "transparent",
          borderTopWidth: 0,
          height: Platform.OS === 'ios' ? 58 : 52,
          paddingBottom: 0,
          paddingTop: 0,
          paddingHorizontal: 2,
          marginHorizontal: 14,
          marginBottom: Platform.OS === 'ios' ? 28 : 24,
          marginTop: 0,
          borderRadius: 28,
          elevation: 7,
          shadowColor: '#0C134F',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.12,
          shadowRadius: 8,
          position: 'absolute',
          borderWidth: 0,
          overflow: 'hidden',
        },
        tabBarItemStyle: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'visible',
          paddingVertical: 0,
          margin: 0,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Dashboard",
          tabBarIcon: ({ color, focused }) => (
            <AnimatedTabIcon
              name={focused ? "home" : "home-outline"}
              size={24}
              color={color}
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="my-assets"
        options={{
          title: "My Assets",
          tabBarIcon: ({ color, focused }) => (
            <AnimatedTabIcon
              name={focused ? "cube" : "cube-outline"}
              size={24}
              color={color}
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="my-requests"
        options={{
          title: "My Requests",
          tabBarIcon: ({ color, focused }) => (
            <AnimatedTabIcon
              name={focused ? "file-document" : "file-document-outline"}
              size={24}
              color={color}
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, focused }) => (
            <AnimatedTabIcon
              name={focused ? "account" : "account-outline"}
              size={24}
              color={color}
              focused={focused}
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 48,
    height: 48,
  },
});
