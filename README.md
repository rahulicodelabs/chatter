# Chatter

A real-time text messaging app — direct messages and group chats — built with
**Next.js 16 (App Router)**, **Supabase** (Postgres + Auth + Realtime), and
**Tailwind CSS 4**.

## Features

- 📨 Direct messages and group chats
- 📎 Photo attachments — pick, caption, and send images (auto-recompress over 5 MB)
- ⚡ Live message delivery via Supabase Realtime (postgres changes)
- ✅ Read receipts: ✓ sent → ✓✓ delivered (grey) → ✓✓ read (blue), live
- 👤 Profile pages with avatar upload (Supabase Storage)
- 🔐 Email/password auth with session refresh on every request
- 🛡️ Row Level Security — users can only read conversations they belong to
- 🔔 Unread badges, last-message previews, read tracking
- 👁 Show/hide password toggle on sign in & sign up
- 📱 Responsive: single-pane on mobile, sidebar + thread on desktop
- 🌗 Follows your system light/dark preference

## Setup

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a free project.
2. Open **SQL Editor → New query**, paste the contents of
   [`supabase/schema.sql`](supabase/schema.sql), and run it.

   This creates the tables (`profiles`, `conversations`,
   `conversation_members`, `messages`), RLS policies, the
   `conversation_summaries` view, an auth trigger that creates a profile for
   every new user, and enables realtime.

   > Already ran an earlier version of the schema? Apply the incremental
   > patches too: [`supabase/fix-rls-recursion.sql`](supabase/fix-rls-recursion.sql)
   > then [`supabase/fix-creator-visibility.sql`](supabase/fix-creator-visibility.sql)
   > then [`supabase/v2-features.sql`](supabase/v2-features.sql) (read receipts
   > table + `avatars` storage bucket)
   > then [`supabase/chat-photos.sql`](supabase/chat-photos.sql) (photo
   > attachments: `attachments` bucket + message photo columns).

### 2. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in the values from **Project Settings → API**:

```
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
```

### 3. (Optional) Disable email confirmation

By default Supabase emails a confirmation link on signup. For quick local
testing, go to **Authentication → Sign In / Up → Providers → Email** and turn
off *Confirm email*. Otherwise, signups show a "check your email" message and
the confirmation link lands on `/auth/callback`.

### 4. Run the app

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), create an account, then:

- Click **+** → **Direct message** to DM another user (create a second account
  to test), or **New group** to create a group chat.
- Open the conversation in two browser windows to see realtime delivery.

## Architecture

```
src/
├── proxy.ts                     # Next 16 "middleware": refreshes Supabase
│                                #   session cookies + auth redirects
├── app/
│   ├── login, signup            # Public auth pages
│   ├── auth/callback/route.ts   # Email-confirmation / OAuth code exchange
│   ├── not-found.tsx
│   └── (chat)/                  # Authed area (guarded by proxy + layout)
│       ├── layout.tsx           # Fetches profile + conversations, renders shell
│       ├── page.tsx             # Empty state ("select a conversation")
│       ├── chat/[id]/page.tsx   # Membership check → fetch messages → thread
│       └── profile/[id]/page.tsx# Profile view (+ edit/upload when it's you)
├── components/
│   ├── chat/
│   │   ├── chat-shell.tsx       # Client state, realtime list updates, context
│   │   ├── conversation-list.tsx
│   │   ├── new-chat-dialog.tsx  # Start DMs / create groups, people search
│   │   ├── conversation-thread.tsx  # Messages, live updates, read receipts, photos, send box
│   │   ├── avatar.tsx           # Image avatar with initials fallback
│   │   └── read-ticks.tsx       # ✓ / ✓✓ / ✓✓ blue status ticks
│   ├── profile/                 # Profile view + avatar upload
│   └── auth/                    # Login/signup forms, password field, sign-out
└── lib/
    ├── supabase/                # Browser, server, and proxy clients
    ├── types.ts                 # Shared DB row types
    ├── images.ts                # Photo validate/recompress/upload helpers
    └── format.ts                # Time/initials helpers
supabase/schema.sql              # Full database schema + RLS + realtime
supabase/v2-features.sql         # Read receipts + avatars bucket (incremental)
supabase/chat-photos.sql         # Photo attachments (incremental)
```

**Data flow**

- Server components do the initial fetch (profile, conversation summaries,
  members, last 100 messages) with the cookie-based server client.
- Client components send messages and subscribe to `postgres_changes` on
  `messages` — inserts appear instantly without refetching.
- RLS is enforced both for REST queries and realtime events, so a user only
  ever receives messages from conversations they're a member of.
- Unread counts come from the `conversation_summaries` view
  (`messages.created_at > last_read_at`); opening a conversation updates
  `conversation_members.last_read_at`.

## Useful scripts

```bash
npm run dev    # dev server (Turbopack)
npm run build  # production build
npm run lint   # eslint
```
