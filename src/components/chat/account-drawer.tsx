"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Avatar } from "@/components/chat/avatar";
import { SignOutButton } from "@/components/auth/sign-out-button";
import type { PublicProfile } from "@/lib/types";

/** Left slide-over with the signed-in account's profile and sign-out actions. */
export function AccountDrawer({
  user,
  onClose,
}: {
  user: PublicProfile;
  onClose: () => void;
}) {
  // Escape closes the drawer.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const name = user.full_name || user.username;

  return (
    <div className="fixed inset-0 z-50 flex">
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Account menu"
        className="relative z-10 flex h-full w-72 max-w-[85vw] flex-col border-r border-border bg-surface shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">Account</p>
          <button
            type="button"
            aria-label="Close menu"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
          >
            ✕
          </button>
        </header>

        <div className="flex flex-1 flex-col items-center gap-1 px-6 pt-8">
          <Avatar src={user.avatar_url} name={name} size="lg" />
          <p className="mt-4 text-base font-semibold">{name}</p>
          <p className="text-sm text-muted-foreground">@{user.username}</p>
        </div>

        <div className="space-y-2 border-t border-border p-4">
          <Link
            href={`/profile/${user.id}`}
            onClick={onClose}
            className="flex w-full items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
          >
            View profile
          </Link>
          <SignOutButton />
        </div>
      </aside>
    </div>
  );
}
