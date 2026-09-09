import { Tabs } from "expo-router";
import React, { useRef, useEffect } from "react";
import { View, StyleSheet, Platform, Animated } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { HapticTab } from "@/components/haptic-tab";

function AnimatedTabIcon({
  name,
  color,
  focused,
  size = 30,
}: {
  name: string;
  color: string;
  focused: boolean;
  size?: number;
}) {
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
    </Animated.View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#FDB833",
        tabBarInactiveTintColor: "rgba(253, 184, 51, 0.5)",
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarButton: HapticTab,
        tabBarStyle: {
          backgroundColor: "#0C134F",
          borderTopWidth: 0,
          height: Platform.OS === 'ios' ? 80 : 74,
          paddingBottom: Platform.OS === 'ios' ? 20 : 10,
          paddingTop: 6,
          paddingHorizontal: 4,
          marginHorizontal: 10,
          marginBottom: 4,
          borderRadius: 30,
          elevation: 12,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.22,
          shadowRadius: 18,
          position: 'absolute',
          bottom: 0,
          left: 8,
          right: 8,
          display: 'flex',
          overflow: 'visible',
        },
        tabBarLabelStyle: {
          display: 'none',
        },
        tabBarItemStyle: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'visible',
          paddingVertical: 2,
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
              size={30}
              color={color}
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="assets"
        options={{
          title: "Assets",
          tabBarIcon: ({ color, focused }) => (
            <AnimatedTabIcon
              name={focused ? "cube" : "cube-outline"}
              size={30}
              color={color}
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="requests"
        options={{
          title: "Requests",
          tabBarIcon: ({ color, focused }) => (
            <AnimatedTabIcon
              name={focused ? "file-document" : "file-document-outline"}
              size={30}
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
              size={30}
              color={color}
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="disposal"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="pullout"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="lifespan"
        options={{
          title: "Lifespan",
          tabBarIcon: ({ color, focused }) => (
            <AnimatedTabIcon
              name={focused ? "clock-alarm" : "clock-alarm-outline"}
              size={30}
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
});
