"use client";

import { useRouter } from "next/navigation";
import { signOutAction } from "@/lib/app-lock-actions";
import { disablePush } from "@/lib/push";

export function SignOutButton() {
  const router = useRouter();

  async function signOut() {
    // Best-effort: drop this device's push subscription (but not the
    // device-level opt-out flag) so the next account starts clean.
    await disablePush({ remember: false });
    try {
      await signOutAction();
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      className="flex w-full items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
    >
      Sign out
    </button>
  );
}
