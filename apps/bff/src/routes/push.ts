import { Hono } from "hono";
import webpush from "web-push";
import { supabase } from "../services/supabase";
import type { HonoVariables } from "../types/hono";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:admin@apmcb.pmpb.online";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const push = new Hono<{ Variables: HonoVariables }>();

/**
 * POST /api/push/broadcast
 * Body: { user_id: string, title: string, body: string, url?: string }
 * Called internally by the Next.js notification creation API.
 * Reads all push subscriptions for the user and fires web pushes.
 */
push.post("/broadcast", async (c) => {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return c.json({ error: "VAPID keys not configured" }, 503);
  }

  const body = await c.req.json<{
    user_id: string;
    title: string;
    body: string;
    url?: string;
  }>();

  if (!body.user_id || !body.title) {
    return c.json({ error: "user_id and title are required" }, 400);
  }


  const { data: subscriptions, error } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth_key")
    .eq("user_id", body.user_id);

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  if (!subscriptions || subscriptions.length === 0) {
    return c.json({ sent: 0 });
  }

  const payload = JSON.stringify({
    title: body.title,
    body: body.body,
    url: body.url ?? "/",
    icon: "/images/logo.png",
    badge: "/images/logo.png",
  });

  const results = await Promise.allSettled(
    subscriptions.map((sub) =>
      webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth_key },
        },
        payload,
        { TTL: 3600 }
      )
    )
  );

  const expired: string[] = [];
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      const err = result.reason as { statusCode?: number };
      // 410 Gone = subscription expired/revoked — clean it up
      if (err?.statusCode === 410) {
        expired.push(subscriptions[i].endpoint);
      }
    }
  });

  if (expired.length > 0) {
    await supabase
      .from("push_subscriptions")
      .delete()
      .in("endpoint", expired);
  }

  const sent = results.filter((r) => r.status === "fulfilled").length;
  return c.json({ sent, expired: expired.length });
});

export { push as pushRoutes };
