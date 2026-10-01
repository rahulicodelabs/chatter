"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LOCALE } from "@/lib/format";
import { Avatar } from "@/components/chat/avatar";
import { PhotoViewer } from "@/components/profile/photo-viewer";
import type { Profile } from "@/lib/types";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB

type Status = { kind: "ok" | "err"; text: string } | null;

export function ProfileView({
  profile,
  isOwn,
  email,
}: {
  profile: Profile;
  isOwn: boolean;
  email: string | null;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingFile = useRef<File | null>(null);

  const [fullName, setFullName] = useState(profile.full_name ?? "");
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [dirty, setDirty] = useState(false);

  const photoUrl = previewUrl ?? avatarUrl;
  const displayName = profile.full_name || profile.username;

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-picking the same file
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setStatus({ kind: "err", text: "Please choose an image file." });
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setStatus({ kind: "err", text: "Image must be smaller than 2 MB." });
      return;
    }

    // Preview as a data URL (next/image can render these directly).
    const reader = new FileReader();
    reader.onload = () => setPreviewUrl(reader.result as string);
    reader.readAsDataURL(file);

    pendingFile.current = file;
    setDirty(true);
    setStatus(null);
  }

  async function save() {
    const supabase = createClient();
    setBusy(true);
    setStatus(null);

    try {
      let url = avatarUrl;
      const file = pendingFile.current;

      if (file) {
        const ext =
          (file.name.split(".").pop() ?? "png")
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "") || "png";
        const path = `${profile.id}/avatar.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(path, file, { upsert: true, contentType: file.type });
        if (uploadError) {
          throw new Error(`Avatar upload failed: ${uploadError.message}`);
        }
        const { data: published } = supabase.storage
          .from("avatars")
          .getPublicUrl(path);
        // Cache-bust so the new image shows immediately.
        url = `${published.publicUrl}?v=${Date.now()}`;
      }

      const trimmed = fullName.trim();
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ full_name: trimmed || null, avatar_url: url })
        .eq("id", profile.id);
      if (updateError) throw new Error(updateError.message);

      setAvatarUrl(url);
      setFullName(trimmed);
      setPreviewUrl(null);
      pendingFile.current = null;
      setDirty(false);
      setStatus({ kind: "ok", text: "Profile saved." });
      router.refresh(); // re-render the shell so the sidebar avatar updates
    } catch (err) {
      setStatus({
        kind: "err",
        text: err instanceof Error ? err.message : "Something went wrong.",
      });
    } finally {
      setBusy(false);
    }
  }

  const joined = new Date(profile.created_at).toLocaleDateString(LOCALE, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3">
        <Link
          href="/"
          aria-label="Back to conversations"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-surface-hover hover:text-foreground md:hidden"
        >
          ←
        </Link>
        <p className="text-sm font-semibold">
          {isOwn ? "Your profile" : "Profile"}
        </p>
      </header>

      <div className="chat-scroll min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 text-center">
          <button
            type="button"
            onClick={
              photoUrl
                ? () => setViewing(true)
                : isOwn
                  ? () => fileRef.current?.click()
                  : undefined
            }
            disabled={!photoUrl && !isOwn}
            aria-label={
              photoUrl ? `View ${displayName}'s photo` : isOwn ? "Change avatar" : undefined
            }
            className={`group relative block ${
              photoUrl || isOwn ? "cursor-pointer" : "cursor-default"
            }`}
          >
            <Avatar
              src={photoUrl}
              name={displayName}
              size="lg"
            />
            {(photoUrl || isOwn) && (
              <span className="absolute inset-0 hidden items-center justify-center rounded-full bg-black/50 text-xs font-medium text-white group-hover:flex">
                {photoUrl ? "View" : "Change"}
              </span>
            )}
          </button>

          <div className="flex flex-wrap items-center justify-center gap-2">
            {photoUrl && (
              <button
                type="button"
                onClick={() => setViewing(true)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
              >
                View profile photo
              </button>
            )}
            {isOwn && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
              >
                Change photo
              </button>
            )}
          </div>

          <div>
            <p className="text-lg font-semibold">
              {profile.full_name || profile.username}
            </p>
            <p className="text-sm text-muted-foreground">@{profile.username}</p>
          </div>

          <div className="w-full space-y-4 text-left">
            {isOwn ? (
              <div>
                <label
                  htmlFor="display-name"
                  className="mb-1.5 block text-sm font-medium"
                >
                  Display name
                </label>
                <input
                  id="display-name"
                  value={fullName}
                  onChange={(event) => {
                    setFullName(event.target.value);
                    setDirty(true);
                  }}
                  placeholder="Your name"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
              </div>
            ) : (
              <div>
                <p className="mb-1.5 block text-sm font-medium">Display name</p>
                <p className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm">
                  {profile.full_name || "—"}
                </p>
              </div>
            )}

            {isOwn && email && (
              <div>
                <p className="mb-1.5 block text-sm font-medium">Email</p>
                <p className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                  {email}
                </p>
              </div>
            )}

            <div>
              <p className="mb-1.5 block text-sm font-medium">Member since</p>
              <p className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                {joined}
              </p>
            </div>
          </div>

          {isOwn && (
            <div className="flex w-full flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => void save()}
                disabled={!dirty || busy}
                className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:bg-accent-hover disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save changes"}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={onFileChange}
                className="hidden"
                aria-label="Choose avatar image"
              />
              {status && (
                <p
                  role="status"
                  className={`text-xs ${
                    status.kind === "ok" ? "text-muted-foreground" : "text-red-500"
                  }`}
                >
                  {status.text}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {viewing && photoUrl && (
        <PhotoViewer
          src={photoUrl}
          alt={displayName}
          onClose={() => setViewing(false)}
        />
      )}
    </div>
  );
}
