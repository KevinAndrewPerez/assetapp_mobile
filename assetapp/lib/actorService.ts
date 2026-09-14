import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

export type ActingUser = {
  id: string | number | null;
  label: string;
};

/**
 * Resolve the label written to log tables (`Approve_by`, audit actors) for the
 * logged-in user. Existing rows store either an email (e.g.
 * alex@nu-lipa.edu.ph) or a full name, so prefer the employee record and fall
 * back to the email on the stored session.
 */
export async function resolveActingUserLabel(): Promise<ActingUser> {
  let fallbackLabel = 'Admin';
  let id: string | number | null = null;

  try {
    const raw = await AsyncStorage.getItem('user');
    if (raw) {
      const user = JSON.parse(raw);
      id = user?.id ?? null;
      fallbackLabel = String(user?.full_name ?? user?.email ?? 'Admin');
    }
  } catch (err) {
    console.warn('Failed to read stored user:', err);
  }

  if (id) {
    try {
      const { data } = await supabase
        .from('users')
        .select('email, employee_numbers (Full_Name)')
        .eq('id', id as any)
        .maybeSingle();
      const employee = Array.isArray((data as any)?.employee_numbers)
        ? (data as any).employee_numbers[0]
        : (data as any)?.employee_numbers;
      const label = String(employee?.Full_Name ?? (data as any)?.email ?? fallbackLabel);
      return { id, label };
    } catch {
      /* fall through to the stored label */
    }
  }

  return { id, label: fallbackLabel };
}
