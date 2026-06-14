import { Hono } from "hono";
import { supabase } from "../services/supabase";
import type { HonoVariables } from "../types/hono";

export const notificationRoutes = new Hono<{ Variables: HonoVariables }>();

// GET /api/notifications — list unread + recent read (last 20)
notificationRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const { data, error } = await supabase
    .from("notifications")
    .select("id, type, title, body, read_at, created_at, metadata")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ notifications: data ?? [] });
});

// GET /api/notifications/unread-count — fast count for bell badge
notificationRoutes.get("/unread-count", async (c) => {
  const userId = c.get("userId");
  const { count, error } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ count: count ?? 0 });
});

// PATCH /api/notifications/read-all — mark all as read (must be before /:id/read)
notificationRoutes.patch("/read-all", async (c) => {
  const userId = c.get("userId");
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null);

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

// PATCH /api/notifications/:id/read — mark single as read
notificationRoutes.patch("/:id/read", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const { data, error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ notification: data });
});
