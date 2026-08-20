import { Tabs } from "expo-router";
import React from "react";
import { View, StyleSheet, Platform } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { HapticTab } from "@/components/haptic-tab";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#FDB833",
        tabBarInactiveTintColor: "#94a3b8",
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarButton: HapticTab,
        tabBarStyle: {
          backgroundColor: "#0C134F",
          borderTopWidth: 0,
          height: Platform.OS === 'ios' ? 70 : 62,
          paddingBottom: Platform.OS === 'ios' ? 16 : 8,
          paddingTop: 10,
          paddingHorizontal: 8,
          marginHorizontal: 16,
          marginBottom: 12,
          borderRadius: 24,
          elevation: 8,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.15,
          shadowRadius: 12,
          position: 'absolute',
          bottom: 0,
          left: 16,
          right: 16,
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
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Dashboard",
          tabBarIcon: ({ color, focused }) => (
            <View style={styles.iconContainer}>
              <MaterialCommunityIcons name={focused ? "home" : "home-outline"} size={26} color={color} />
              {focused && <View style={styles.activeIndicator} />}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="assets"
        options={{
          title: "Assets",
          tabBarIcon: ({ color, focused }) => (
            <View style={styles.iconContainer}>
              <MaterialCommunityIcons name={focused ? "cube" : "cube-outline"} size={26} color={color} />
              {focused && <View style={styles.activeIndicator} />}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="requests"
        options={{
          title: "Requests",
          tabBarIcon: ({ color, focused }) => (
            <View style={styles.iconContainer}>
              <MaterialCommunityIcons name={focused ? "file-document" : "file-document-outline"} size={26} color={color} />
              {focused && <View style={styles.activeIndicator} />}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, focused }) => (
            <View style={styles.iconContainer}>
              <MaterialCommunityIcons name={focused ? "account" : "account-outline"} size={26} color={color} />
              {focused && <View style={styles.activeIndicator} />}
            </View>
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
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 56,
    height: 56,
  },
  activeIndicator: {
    position: 'absolute',
    bottom: 2,
    width: 28,
    height: 3,
    backgroundColor: '#FDB833',
    borderRadius: 2,
  },
});
