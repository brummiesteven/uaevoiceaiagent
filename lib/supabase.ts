import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { optionalEnv, supabaseConfigured } from "./env";

let client: SupabaseClient | null = null;

/** Service-role client. Returns null when Supabase is not configured yet. */
export function getSupabase(): SupabaseClient | null {
  if (!supabaseConfigured()) return null;
  if (!client) {
    client = createClient(
      optionalEnv("NEXT_PUBLIC_SUPABASE_URL")!,
      optionalEnv("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
  }
  return client;
}
