import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { fetchAlertCounts } from '@/lib/assetService';
import { fetchUnreadNotificationCount, isOfficeRole } from '@/lib/notificationService';

type Props = {
  color?: string;
  /**
   * Force the two alert icons on/off. By default they only appear for the Asset
   * Management Office (Admin / AssetOfficer), because maintenance and lifespan
   * evaluation belong to the office rather than to an employee.
   */
  showAlerts?: boolean;
};

/**
 * Header alert cluster: the real notification bell (unread count → /notifications)
 * plus the office's two standing queues — scheduled maintenance that is due and
 * assets whose lifespan expired and need evaluation.
 */
export default function NotificationBell({ color = '#FFFFFF', showAlerts }: Props) {
  const router = useRouter();
  const [count, setCount] = useState(0);
  const [alerts, setAlerts] = useState({ maintenance: 0, evaluation: 0 });
  const [isAdmin, setIsAdmin] = useState(showAlerts ?? false);

  const refresh = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem('user');
      if (!raw) {
        setCount(0);
        setAlerts({ maintenance: 0, evaluation: 0 });
        setIsAdmin(showAlerts ?? false);
        return;
      }
      const user = JSON.parse(raw);
      const admin = showAlerts ?? isOfficeRole(user?.role);
      setIsAdmin(admin);
      setCount(await fetchUnreadNotificationCount(user?.id));
      if (admin) setAlerts(await fetchAlertCounts());
      else setAlerts({ maintenance: 0, evaluation: 0 });
    } catch (e) {
      console.warn('Failed to load notification count:', e);
    }
  }, [showAlerts]);

  // Re-check whenever the screen regains focus (e.g. returning from the list).
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const renderAlert = (
    key: 'maintenance' | 'evaluation',
    icon: string,
    tone: string,
    route: string,
    label: string,
  ) => {
    const value = alerts[key];
    return (
      <TouchableOpacity
        style={styles.button}
        activeOpacity={0.7}
        onPress={() => router.push(route as any)}
        accessibilityLabel={`${label}${value > 0 ? `, ${value} pending` : ''}`}
      >
        <MaterialCommunityIcons name={icon as any} size={24} color={color} />
        {value > 0 && (
          <View style={[styles.badge, { backgroundColor: tone }]}>
            <Text style={styles.badgeText}>{value > 99 ? '99+' : value}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.cluster}>
      {isAdmin
        ? renderAlert(
            'maintenance',
            'wrench-outline',
            '#F59E0B',
            '/maintenance',
            'Maintenance due',
          )
        : null}
      {isAdmin
        ? renderAlert(
            'evaluation',
            'clock-alert-outline',
            '#EF4444',
            '/lifespan',
            'Assets requiring lifespan evaluation',
          )
        : null}

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
    </View>
  );
}

const styles = StyleSheet.create({
  cluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
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
