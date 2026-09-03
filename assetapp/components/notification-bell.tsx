import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { fetchUnreadNotificationCount } from '@/lib/notificationService';

type Props = {
  color?: string;
};

/** Real notification bell: shows the unread count and opens /notifications. */
export default function NotificationBell({ color = '#FFFFFF' }: Props) {
  const router = useRouter();
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem('user');
      if (!raw) {
        setCount(0);
        return;
      }
      const user = JSON.parse(raw);
      setCount(await fetchUnreadNotificationCount(user?.id));
    } catch (e) {
      console.warn('Failed to load notification count:', e);
    }
  }, []);

  // Re-check whenever the screen regains focus (e.g. returning from the list).
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  return (
    <TouchableOpacity
      style={styles.button}
      activeOpacity={0.7}
      onPress={() => router.push('/notifications')}
      accessibilityLabel={`Notifications${count > 0 ? `, ${count} unread` : ''}`}
    >
      <MaterialCommunityIcons name="bell-outline" size={24} color={color} />
      {count > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#FDB833',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1E3A5F',
  },
});
