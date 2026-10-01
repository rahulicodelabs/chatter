import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProfileView } from "@/components/profile/profile-view";
import type { Profile } from "@/lib/types";

export default async function ProfilePage(props: PageProps<"/profile/[id]">) {
  const { id } = await props.params;

  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username, full_name, avatar_url, created_at")
    .eq("id", id)
    .maybeSingle();

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
