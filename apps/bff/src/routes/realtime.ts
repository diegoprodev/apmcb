import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { createClient } from "@supabase/supabase-js";
import type { HonoVariables } from "../types/hono";
import type { SessionData } from "../lib/session";

const realtimeRoutes = new Hono<{ Variables: HonoVariables }>();

// Module-level singleton — service role, no auth state, safe to share across connections.
// All SSE connections multiplex their channels over ONE Supabase Realtime WebSocket,
// instead of opening N WebSockets (one per user). Use removeChannel(ch) on cleanup —
// NOT removeAllChannels(), which would nuke every other active connection's subscriptions.
const supabaseRt = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 10 } },
  }
);

type Sub = {
  table: string;
  event: "INSERT" | "UPDATE" | "DELETE";
  filter?: string;
};

type ChannelDef = {
  allowedRoles?: HonoVariables["role"][];
  requireNexusAuthorized?: boolean;
  subs: (s: Pick<SessionData, "userId" | "tenantId" | "reserveId">) => Sub[];
  sendRow?: boolean;
};

const CHANNELS: Record<string, ChannelDef> = {
  "efetivo-sync": {
    subs: ({ userId }) =>
      userId
        ? [
            { table: "profiles",          event: "UPDATE", filter: `id=eq.${userId}` },
            { table: "lendings",           event: "INSERT", filter: `military_id=eq.${userId}` },
            { table: "lendings",           event: "UPDATE", filter: `military_id=eq.${userId}` },
            { table: "lendings",           event: "DELETE", filter: `military_id=eq.${userId}` },
            { table: "material_requests",  event: "INSERT", filter: `military_id=eq.${userId}` },
            { table: "material_requests",  event: "UPDATE", filter: `military_id=eq.${userId}` },
            { table: "material_requests",  event: "DELETE", filter: `military_id=eq.${userId}` },
          ]
        : [],
  },
  "armeiro-sync": {
    allowedRoles: ["armeiro", "admin_reserva", "admin_global", "superadmin"],
    subs: ({ tenantId }) =>
      tenantId
        ? [
            { table: "lendings",          event: "INSERT", filter: `tenant_id=eq.${tenantId}` },
            { table: "lendings",          event: "UPDATE", filter: `tenant_id=eq.${tenantId}` },
            { table: "lendings",          event: "DELETE", filter: `tenant_id=eq.${tenantId}` },
            { table: "material_requests", event: "INSERT", filter: `tenant_id=eq.${tenantId}` },
            { table: "material_requests", event: "UPDATE", filter: `tenant_id=eq.${tenantId}` },
            { table: "material_requests", event: "DELETE", filter: `tenant_id=eq.${tenantId}` },
          ]
        : [],
  },
  "arsenal-sync": {
    allowedRoles: ["armeiro", "admin_reserva", "admin_global", "superadmin"],
    subs: ({ tenantId }) =>
      tenantId
        ? [
            { table: "material_items",    event: "INSERT", filter: `tenant_id=eq.${tenantId}` },
            { table: "material_items",    event: "UPDATE", filter: `tenant_id=eq.${tenantId}` },
            { table: "material_items",    event: "DELETE", filter: `tenant_id=eq.${tenantId}` },
            { table: "material_types",    event: "INSERT", filter: `tenant_id=eq.${tenantId}` },
            { table: "material_types",    event: "UPDATE", filter: `tenant_id=eq.${tenantId}` },
            { table: "material_types",    event: "DELETE", filter: `tenant_id=eq.${tenantId}` },
            { table: "lendings",          event: "INSERT", filter: `tenant_id=eq.${tenantId}` },
            { table: "lendings",          event: "UPDATE", filter: `tenant_id=eq.${tenantId}` },
            { table: "lendings",          event: "DELETE", filter: `tenant_id=eq.${tenantId}` },
          ]
        : [],
  },
  // Filtered by tenantId to prevent cross-tenant noise (service role bypasses RLS).
  // superadmin on /admin/usuarios always has a tenantId (they operate within a tenant).
  "admin-profiles-grid": {
    allowedRoles: ["admin_global", "admin_reserva", "armeiro", "superadmin"],
    subs: ({ tenantId }) =>
      tenantId
        ? [
            { table: "profiles", event: "INSERT", filter: `default_tenant_id=eq.${tenantId}` },
            { table: "profiles", event: "UPDATE", filter: `default_tenant_id=eq.${tenantId}` },
          ]
        : [],
  },
  // sendRow: true — o client filtra client-side pelo shift_id ativo (evita
  // refresh cruzado quando outro armeiro do mesmo tenant também tem turno aberto).
  "livro-sync": {
    allowedRoles: ["armeiro", "admin_reserva", "admin_global", "superadmin"],
    subs: ({ tenantId }) =>
      tenantId
        ? [{ table: "service_log_events", event: "INSERT", filter: `tenant_id=eq.${tenantId}` }]
        : [],
    sendRow: true,
  },
  "nexus-events": {
    allowedRoles: ["superadmin"],
    requireNexusAuthorized: true,
    subs: () => [{ table: "audit_logs", event: "INSERT" }],
    sendRow: true,
  },
  "nexus-errors": {
    allowedRoles: ["superadmin"],
    requireNexusAuthorized: true,
    subs: () => [{ table: "audit_logs", event: "INSERT" }],
    sendRow: true,
  },
  "notifications": {
    subs: ({ userId }) =>
      userId
        ? [
            { table: "notifications", event: "INSERT", filter: `user_id=eq.${userId}` },
            { table: "notifications", event: "UPDATE", filter: `user_id=eq.${userId}` },
          ]
        : [],
    sendRow: true,
  },
};

realtimeRoutes.get("/stream", async (c) => {
  const userId        = c.get("userId");
  const role          = c.get("role");
  const tenantId      = c.get("tenantId");
  const reserveId     = c.get("reserveId");
  const nexusAuthorized = c.get("nexusAuthorized") ?? false;

  const channelName = c.req.query("channel");
  if (!channelName) return c.json({ error: "channel param required" }, 400);

  const def = CHANNELS[channelName];
  if (!def) return c.json({ error: "unknown channel" }, 400);

  if (def.allowedRoles && !def.allowedRoles.includes(role)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  if (def.requireNexusAuthorized && !nexusAuthorized) {
    return c.json({ error: "Nexus authorization required" }, 403);
  }

  const subs = def.subs({ userId, tenantId, reserveId });
  if (subs.length === 0) return c.json({ error: "No subscriptions for this context" }, 400);

  // X-Accel-Buffering: no — prevents nginx from buffering the SSE stream on the Hetzner VPS.
  c.header("X-Accel-Buffering", "no");

  return streamSSE(c, async (stream) => {
    let alive = true;
    // wakeup is called by onAbort to unblock the abortable sleep immediately.
    let wakeup: (() => void) | null = null;
    stream.onAbort(() => {
      alive = false;
      wakeup?.();
    });

    // Unique channel ID prevents event cross-contamination between concurrent connections.
    const chanId = `bff-${channelName}-${userId}-${Date.now()}`;
    const rtChannel = supabaseRt.channel(chanId);

    for (const sub of subs) {
      rtChannel.on(
        "postgres_changes",
        {
          event: sub.event,
          schema: "public",
          table: sub.table,
          ...(sub.filter ? { filter: sub.filter } : {}),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          if (!alive) return;
          const data: Record<string, unknown> = {
            table: sub.table,
            type: payload.eventType,
          };
          if (def.sendRow) data.row = payload.new;
          stream
            .writeSSE({ event: "change", data: JSON.stringify(data) })
            .catch(() => { alive = false; });
        }
      );
    }

    // Wait for Supabase Realtime to confirm the subscription before signalling ready.
    // Sending ready before SUBSCRIBED causes tests (and production) to race: they
    // see __rtReady=true and immediately trigger DB writes, but if the subscription
    // isn't confirmed yet those events are missed entirely.
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => { if (!settled) { settled = true; resolve(); } };
      // Resolve on SUBSCRIBED or any terminal status (TIMED_OUT, CLOSED, CHANNEL_ERROR).
      // Cap at 8s so a permanently failing subscription doesn't block the SSE stream.
      const t = setTimeout(done, 8_000);
      rtChannel.subscribe((status: string) => {
        if (["SUBSCRIBED", "TIMED_OUT", "CLOSED", "CHANNEL_ERROR"].includes(status)) {
          clearTimeout(t);
          done();
        }
      });
    });

    // Client may disconnect during the subscribe race — guard before first write.
    if (alive) {
      await stream.writeSSE({ event: "ready", data: "connected" }).catch(() => {
        alive = false;
      });
    }

    // Keepalive ping every 25s. Uses an abortable sleep so disconnect immediately
    // unblocks the loop instead of waiting up to 25s (which would hold the Supabase
    // channel open and delay cleanup).
    while (alive) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 25_000);
        wakeup = () => { clearTimeout(t); resolve(); };
      });
      wakeup = null;
      if (!alive) break;
      await stream
        .writeSSE({ event: "ping", data: String(Date.now()) })
        .catch(() => { alive = false; });
    }

    // removeChannel() removes only THIS connection's channel from the shared singleton.
    // The underlying WebSocket stays open if other connections are still active.
    await supabaseRt.removeChannel(rtChannel).catch(() => {});
  });
});

export { realtimeRoutes };
