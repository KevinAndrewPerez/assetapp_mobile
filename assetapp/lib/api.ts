import Constants from 'expo-constants';

interface ExpoExtra {
  EXPO_PUBLIC_API_URL?: string;
  API_URL?: string;
}

const expoConfig = (Constants.expoConfig ?? {}) as { extra?: ExpoExtra };

export const apiBaseUrl = (
  process.env.EXPO_PUBLIC_API_URL ||
  expoConfig.extra?.EXPO_PUBLIC_API_URL ||
  expoConfig.extra?.API_URL ||
  'http://localhost:8000'
).replace(/\/$/, '');
