import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { createClient } from '@supabase/supabase-js';

// 1. Tell TypeScript what the "extra" box contains
interface ExpoExtra {
  EXPO_PUBLIC_SUPABASE_URL?: string;
  EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}

// 2. Apply that "map" to the config
const expoConfig = (Constants.expoConfig ?? {}) as { extra?: ExpoExtra };

const supabaseUrl = (
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  expoConfig.extra?.EXPO_PUBLIC_SUPABASE_URL ||
  expoConfig.extra?.SUPABASE_URL ||
  ''
) as string;

const supabaseAnonKey = (
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  expoConfig.extra?.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  expoConfig.extra?.SUPABASE_ANON_KEY ||
  ''
) as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Supabase environment variables are required: EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    detectSessionInUrl: false,
    autoRefreshToken: true,
  },
});

export const supabaseStorage = supabase;
