"use client";

import { useEffect } from "react";
import { AppLockCard } from "@/components/auth/app-lock-card";

/** Centered dialog with the App lock settings (opened from the account drawer). */
export function AppLockDialog({ onClose }: { onClose: () => void }) {
  // Escape closes the dialog.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="App lock"
        className="relative z-10 flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">App lock</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground transition hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <div className="chat-scroll overflow-y-auto p-4">
          <AppLockCard />
        </div>
      </div>
    </div>
  );
}
