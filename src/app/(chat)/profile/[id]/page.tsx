import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { ProfileView } from "@/components/profile/profile-view";
import type { Profile } from "@/lib/types";

export default async function ProfilePage(props: PageProps<"/profile/[id]">) {
  const { id } = await props.params;

  const supabase = await createClient();

  // The profile id comes from the route, so the lookup and the auth
  // verification can run in parallel instead of back to back.
  const userPromise = getCurrentUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username, full_name, avatar_url, created_at")
    .eq("id", id)
    .maybeSingle();

  const authUser = await userPromise;
  if (!authUser) redirect("/login");

  if (!profile) notFound();

  const isOwn = profile.id === authUser.id;

  return (
    <ProfileView
      profile={profile as Profile}
      isOwn={isOwn}
      email={isOwn ? (authUser.email ?? null) : null}
    />
  );
}
