import type { ConversationMember, PublicProfile } from "./types";

function asProfile(value: unknown): PublicProfile {
  // supabase-js types embeds as arrays even for many-to-one relations;
  // PostgREST returns an object here, but accept both shapes.
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? {}) as PublicProfile;
}

/** Normalizes raw `conversation_members` rows with an embedded `profile`. */
export function normalizeMembers(rows: unknown): ConversationMember[] {
  return ((rows ?? []) as Array<Record<string, unknown>>).map((row) => ({
    ...row,
    profile: asProfile(row.profile),
  })) as unknown as ConversationMember[];
}
