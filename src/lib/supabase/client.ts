import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseConfig } from "./config";

/** Supabase client for Client Components (browser). */
export function createClient() {
  const { url, anonKey } = getSupabaseConfig();
  return createBrowserClient(url, anonKey);
}
