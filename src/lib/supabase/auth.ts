import { cache } from "react";
import { createClient } from "./server";
import type { Profile } from "@/lib/types";

/**
 * Server-verified identity for the current request.
 *
 * `getUser()` round-trips to the Supabase auth server, so it must happen at
 * most once per render: `cache()` dedupes it when the layout, page, and other
 * server components all ask for the current user.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/**
 * The signed-in user's profile row — shares the cached auth check above, so
 * routes that need both pay for a single auth round trip.
 */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, username, full_name, avatar_url, created_at")
    .eq("id", user.id)
    .maybeSingle();

  return (data as Profile | null) ?? null;
});
