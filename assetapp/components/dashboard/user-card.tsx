import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { Avatar } from '@/components/avatar';

interface UserCardProps {
  name: string;
  role: string;
  organization: string;
  avatarInitials?: string;
  /** The user's uploaded `profile_photo` reference, when they have one. */
  photo?: string | null;
}

export function UserCard({
  name,
  role,
  organization,
  avatarInitials = 'AD',
  photo,
}: UserCardProps) {
  return (
    <LinearGradient
      colors={['#0C134F', '#1E3A5F']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.card}
    >
      <View style={styles.contentContainer}>
        <View style={styles.textContainer}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.subtitle}>
            {role} • {organization}
          </Text>
        </View>
        {photo ? (
          <Avatar name={name} photo={photo} size={54} borderRadius={18} style={styles.avatar} />
        ) : (
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{avatarInitials}</Text>
          </View>
        )}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 18,
    borderRadius: 18,
    marginHorizontal: 16,
    marginBottom: 18,
    shadowColor: '#0C134F',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 18,
    elevation: 8,
  },
  contentContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  textContainer: {
    flex: 1,
  },
  name: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
    letterSpacing: 0.2,
  },
  subtitle: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: '#FDB833',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
    shadowColor: '#F0A925',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 5,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#3D2E00',
  },
});
