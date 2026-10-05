import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/supabase/auth";
import { readLockState, sanitizeNext } from "@/lib/app-lock";
import { LockScreen } from "@/components/auth/lock-screen";

export const metadata = {
  title: "Locked",
};

/**
 * Standalone gate page (deliberately OUTSIDE the (chat) layout, so the
 * sidebar and its conversation data never render while locked). The proxy
 * redirects here; after a successful unlock the client navigates to ?next=.
 */
export default async function LockPage(props: PageProps<"/lock">) {
  const searchParams = await props.searchParams;
  const params = searchParams as { next?: string | string[]; e?: string };

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const next = sanitizeNext(params.next);
  const email = user.email ?? null;

  if (params.e === "config") {
    return <LockScreen next={next} email={email} configError />;
  }

  let required = false;
  let unlocked = false;
  try {
    const store = await cookies();
    const state = await readLockState((name) => store.get(name)?.value, user.id);
    required = state.required;
    unlocked = state.unlocked;
  } catch (error) {
    // APP_LOCK_SECRET missing — show setup guidance instead of failing.
    console.error("app-lock page:", error);
    return <LockScreen next={next} email={email} configError />;
  }

  // Not actually locked (stale link / just unlocked) — go where they wanted.
  // NOTE: redirect() throws NEXT_REDIRECT, so it must stay outside the try.
  if (!required || unlocked) redirect(next);

  return <LockScreen next={next} email={email} />;
}
