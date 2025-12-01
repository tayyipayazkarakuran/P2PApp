import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseInstance: SupabaseClient | null = null;

export const getSupabase = (url: string, key: string): SupabaseClient => {
  if (!supabaseInstance) {
    supabaseInstance = createClient(url, key, {
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    });
  } else {
    // Re-init if keys change (edge case)
    // In a real app we might want to handle this better, but for this scope:
    const currentUrl = (supabaseInstance as any).supabaseUrl;
    if (currentUrl !== url) {
       supabaseInstance = createClient(url, key);
    }
  }
  return supabaseInstance;
};

export const cleanupSupabase = () => {
  if (supabaseInstance) {
    supabaseInstance.removeAllChannels();
    supabaseInstance = null;
  }
};