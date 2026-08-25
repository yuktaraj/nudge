export const env = {
  // Try to use the .env file, but if it fails, use the hardcoded string
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://ignqpyytmofspzcritoa.supabase.cow',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_i2YRGcAlD_wHCw3sYpR-Sg_9A0oIpoF',
};

export function hasSupabaseConfig() {
  return Boolean(env.supabaseUrl && env.supabaseAnonKey);
}