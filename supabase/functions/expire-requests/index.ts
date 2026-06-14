// Supabase Edge Function — expire-requests
// Scheduled every 30 minutes via pg_cron / Supabase Dashboard cron job.
// 1. Calls expire_material_requests() to flip status → expirado
// 2. For each newly expired request, sends push notification to the military
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (_req) => {
  try {
    // 1. Get approved+expired requests BEFORE running the function
    const { data: aboutToExpire } = await supabase
      .from("material_requests")
      .select("id, military_id")
      .eq("status", "aprovado")
      .lt("expires_at", new Date().toISOString());

    // 2. Run expiration
    const { data: expiredCount, error: expireErr } = await supabase.rpc(
      "expire_material_requests",
    );
    if (expireErr) throw expireErr;

    // 3. Notify each affected military
    const notifications = (aboutToExpire ?? []).map((req) => ({
      user_id: req.military_id,
      type: "armament_expired",
      title: "Prazo encerrado",
      body: "Você não retirou o material no prazo de 6 horas. A solicitação foi encerrada.",
      metadata: { request_id: req.id },
      read: false,
    }));

    if (notifications.length > 0) {
      await supabase.from("notifications").insert(notifications);
    }

    return new Response(
      JSON.stringify({ expired: expiredCount ?? 0, notified: notifications.length }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("expire-requests error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
