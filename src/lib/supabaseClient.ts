import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { CONFIG } from './config';
// read the email-link result before the client consumes the URL
import './emailLink';

// Singleton instance. Null when the project is not configured.
export const supabase: SupabaseClient | null =
  CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY
    ? createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null;
