import { timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import webpush from "web-push";

/**
 * Webhook target for the `notify_message_push` pg_net trigger (see
 * supabase/push-notifications.sql): verifies the shared secret, then fans
 * the message out to every recipient's browser via Web Push.
 *
 * Auth is the x-chatter-push-secret header (proxy.ts's matcher excludes
 * /api, so this route is never touched by the auth/app-lock redirects).
 */

/** One opted-in device, as assembled by the database trigger. */
type PushRecipient = {
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  /** Recipient has app lock on → notification may only show the sender. */
  locked: boolean;
};

/** Fan-out payload POSTed by notify_message_push(). */
type PushPayload = {
  conversation_id: string;
  conversation_type: "dm" | "group";
  conversation_title: string | null;
  sender_name: string;
  preview: string;
  image_url: string | null;
  recipients: PushRecipient[];
};

/** What public/sw.js receives inside the push event. */
type NotificationPayload = {
  title: string;
  body: string;
  image: string | null;
  conversationId: string;
  url: string;
};

const SECRET_HEADER = "x-chatter-push-secret";
const VAPID_SUBJECT =
  process.env.VAPID_SUBJECT ?? "https://chatter-orpin-ten.vercel.app";
/** Chat alerts go stale fast — undelivered pushes die after 2 hours. */
const TTL_SECONDS = 2 * 60 * 60;
/** Mirrors the trigger's 🎬/📷 preview logic in conversation_summaries. */
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv|avi|mkv)([?#].*)?$/i;

/** Fan-out runs in `after()`; give it room beyond the default. */
export const maxDuration = 30;

/** Constant-time comparison of the webhook secret. */
function secretsMatch(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPushPayload(value: unknown): value is PushPayload {
  if (!isObject(value)) return false;
  if (typeof value.conversation_id !== "string" || !value.conversation_id) {
    return false;
  }
  if (value.conversation_type !== "dm" && value.conversation_type !== "group") {
    return false;
  }
  if (value.conversation_title !== null && typeof value.conversation_title !== "string") {
    return false;
  }
  if (typeof value.sender_name !== "string") return false;
  if (typeof value.preview !== "string") return false;
  if (value.image_url !== null && typeof value.image_url !== "string") return false;

  const recipients = value.recipients;
  if (!Array.isArray(recipients) || recipients.length === 0 || recipients.length > 500) {
    return false;
  }
  return recipients.every(
    (recipient) =>
      isObject(recipient) &&
      typeof recipient.endpoint === "string" &&
      recipient.endpoint.startsWith("https://") &&
      typeof recipient.p256dh === "string" &&
      recipient.p256dh.length > 10 &&
      typeof recipient.auth === "string" &&
      recipient.auth.length > 10 &&
      typeof recipient.locked === "boolean"
  );
}

/** Per-recipient title/body — app-lock accounts never see message content. */
function buildNotification(
  payload: PushPayload,
  recipient: PushRecipient
): NotificationPayload {
  const conversationId = payload.conversation_id;
  const url = `/chat/${conversationId}`;
  const sender = (payload.sender_name || "Someone").slice(0, 80);
  const preview = (payload.preview || "New message").slice(0, 200);

  if (recipient.locked) {
    // App lock on: reveal only WHO sent it — content stays behind the PIN.
    return { title: sender, body: "New message", image: null, conversationId, url };
  }

  const image =
    payload.image_url && !VIDEO_EXT.test(payload.image_url) ? payload.image_url : null;

  if (payload.conversation_type === "dm") {
    return { title: sender, body: preview, image, conversationId, url };
  }
  const group = (payload.conversation_title || "Group chat").slice(0, 80);
  return {
    title: group,
    body: `${sender}: ${preview}`.slice(0, 200),
    image,
    conversationId,
    url,
  };
}

/** Remove subscriptions the push service has retired (uninstalled browser). */
async function pruneEndpoints(endpoints: string[]): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.warn(
      `push: ${endpoints.length} dead subscription(s) kept (SUPABASE_SERVICE_ROLE_KEY not set)`
    );
    return;
  }
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(
        `${url}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`,
        {
          method: "DELETE",
          headers: {
            apikey: serviceKey,
            authorization: `Bearer ${serviceKey}`,
          },
        }
      );
      if (!response.ok) {
        console.error(`push: pruning dead subscription failed (${response.status})`);
      }
    } catch (error) {
      console.error("push: pruning dead subscription errored", error);
    }
  }
}

async function deliver(payload: PushPayload): Promise<void> {
  const results = await Promise.all(
    payload.recipients.map(async (recipient) => {
      const notification = buildNotification(payload, recipient);
      try {
        await webpush.sendNotification(
          {
            endpoint: recipient.endpoint,
            keys: { p256dh: recipient.p256dh, auth: recipient.auth },
          },
          JSON.stringify(notification),
          { TTL: TTL_SECONDS }
        );
        return { endpoint: recipient.endpoint, ok: true, statusCode: 200 };
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode ?? 0;
        console.error(
          `push: send failed (${statusCode || "?"})`,
          error instanceof Error ? error.message : error
        );
        return { endpoint: recipient.endpoint, ok: false, statusCode };
      }
    })
  );

  const sent = results.filter((result) => result.ok).length;
  const dead = results
    .filter(
      (result) =>
        !result.ok && (result.statusCode === 404 || result.statusCode === 410)
    )
    .map((result) => result.endpoint);
  console.log(
    `push: queued=${payload.recipients.length} sent=${sent} failed=${results.length - sent} dead=${dead.length}`
  );
  if (dead.length > 0) await pruneEndpoints(dead);
}

export async function POST(request: Request) {
  const secret = process.env.PUSH_WEBHOOK_SECRET;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;

  if (!secret || !publicKey || !privateKey) {
    console.error(
      "push: server missing PUSH_WEBHOOK_SECRET / NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY"
    );
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }
  if (!secretsMatch(request.headers.get(SECRET_HEADER), secret)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!isPushPayload(body)) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }
  const payload: PushPayload = body;

  try {
    webpush.setVapidDetails(VAPID_SUBJECT, publicKey, privateKey);
  } catch (error) {
    console.error("push: invalid VAPID configuration", error);
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  // Respond instantly: pg_net only waits for this acknowledgement (5s
  // timeout) — the actual fan-out runs after the response is flushed.
  after(() => deliver(payload));

  return NextResponse.json({ queued: payload.recipients.length });
}
