-- Chatter — per-user app lock (passcode required to open the app)
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
--
-- Also requires the APP_LOCK_SECRET environment variable to be set on the
-- deployment (Vercel → Settings → Environment Variables) and locally in
-- .env.local, otherwise the lock fails closed with a setup notice.

alter table public.profiles
  add column if not exists passcode_hash text;

comment on column public.profiles.passcode_hash is
  'PBKDF2-SHA256 hash of the account app-lock passcode (4-8 digits); NULL when the lock is off.';
