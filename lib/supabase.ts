import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { accountStorageUploadFetch } from './accountStorageUploadFetch';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

let client: SupabaseClient | null = null;

export const getSupabaseClient = (): SupabaseClient | null => {
  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  if (client === null) {
    client = createClient(supabaseUrl, supabaseAnonKey, {
      global: { fetch: accountStorageUploadFetch(supabaseUrl, (...args) => fetch(...args)) },
      auth: {
        storage: AsyncStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }

  return client;
};

export const getRequiredSupabaseClient = (): SupabaseClient => {
  const required = getSupabaseClient();
  if (required === null) {
    throw new Error(
      'Supabase yapılandırması eksik. .env içinde EXPO_PUBLIC_SUPABASE_URL ve EXPO_PUBLIC_SUPABASE_ANON_KEY tanımlı olmalı.',
    );
  }
  return required;
};
