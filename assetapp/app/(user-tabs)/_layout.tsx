import { Tabs } from "expo-router";
import React, { useRef, useEffect } from "react";
import { View, StyleSheet, Platform, Animated, type ColorValue } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

import { HapticTab } from "@/components/haptic-tab";

function AnimatedTabIcon({ name, color, focused, size = 28 }: { name: string; color: ColorValue; focused: boolean; size?: number }) {
  const scale = useRef(new Animated.Value(1)).current;
  const rotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: focused ? 1.15 : 1,
        useNativeDriver: true,
        tension: 100,
        friction: 6,
      }),
      Animated.timing(rotate, {
        toValue: focused ? 1 : 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, [focused]);

  return (
    <Animated.View style={[styles.iconWrap, { transform: [{ scale }, { rotate: rotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '5deg'] }) }] }]}>
      <MaterialCommunityIcons name={name as any} size={size} color={color} />
      <Animated.View style={[styles.activeDot, { opacity: focused ? 1 : 0 }]} />
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
          height: Platform.OS === 'ios' ? 76 : 70,
          paddingBottom: 0,
          paddingTop: 0,
          paddingHorizontal: 2,
          marginHorizontal: 12,
          marginBottom: Platform.OS === 'ios' ? 28 : 24,
          marginTop: 0,
          borderRadius: 30,
          elevation: 10,
          shadowColor: '#0C134F',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.15,
          shadowRadius: 10,
          position: 'absolute',
          borderWidth: 0,
          overflow: 'hidden',
        },
        tabBarItemStyle: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'visible',
          paddingVertical: 2,
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
              size={28}
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
              size={28}
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
              size={28}
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
              size={28}
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
  },
  activeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#0C134F',
    marginTop: 3,
  },
});
