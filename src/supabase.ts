import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Replaced by the existing build script's strict public-variable allowlist.
declare const __SUPABASE_URL__: string;
declare const __SUPABASE_PUBLISHABLE_KEY__: string;
let client: SupabaseClient | null = null;
export const AUTH_STORAGE_KEY = "study-metro:auth";

export function getSupabaseClient(): SupabaseClient | null {
  if (client) return client;
  const url = typeof __SUPABASE_URL__ === "string" ? __SUPABASE_URL__ : "";
  const key = typeof __SUPABASE_PUBLISHABLE_KEY__ === "string" ? __SUPABASE_PUBLISHABLE_KEY__ : "";
  if (!url || !key) return null;
  client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: AUTH_STORAGE_KEY },
    global: { fetch: (input, init) => {
      const timeout = AbortSignal.timeout(15_000);
      return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
    } }
  });
  return client;
}
