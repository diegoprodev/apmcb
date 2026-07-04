
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SolicitacoesClient } from "./_solicitacoes-client";
import { resolvePhotoUrl } from "@/lib/storage";

export default async function SolicitacoesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = await searchParams;
  const limit = Math.min(Math.max(parseInt(params?.limit ?? "20") || 20, 10), 50);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, default_tenant_id")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "armeiro" && profile?.role !== "admin_global" && profile?.role !== "admin_reserva" && profile?.role !== "superadmin") redirect("/");

  // BUG-RR-07: filtro explícito por tenant (RLS também garante, mas defense-in-depth)
  let query = supabase
    .from("material_requests")
    .select(`
      id, status, notes, denial_reason, armeiro_nota,
      remote_reason, is_external_request, reserve_id, tenant_id,
      cancellation_reason, totp_validated, requested_at, approved_at,
      rejected_at, delivered_at, cancelled_at, expires_at,
      military:profiles!material_requests_military_id_fkey(
        id, nome_completo, posto, matricula, foto_url
      ),
      reserva:profiles!material_requests_reserva_id_fkey(
        id, nome_completo
      ),
      items:material_request_items(
        id, material_type_id,
        material_nome_snapshot, material_categoria_snapshot,
        requested_quantity, delivered_quantity
      )
    `)
    .order("requested_at", { ascending: false })
    .limit(limit + 1);

  if (profile.default_tenant_id) {
    query = query.eq("tenant_id", profile.default_tenant_id);
  }

  const { data: rawRequests } = await query;
  const hasMore = (rawRequests ?? []).length > limit;
  const requests = hasMore ? (rawRequests ?? []).slice(0, limit) : (rawRequests ?? []);

  // Resolve signed URLs para fotos dos militares nas solicitações
  const resolvedRequests = await Promise.all(
    requests.map(async (r) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const military = r.military as any;
      if (!military) return r;
      const foto_url = await resolvePhotoUrl(military.foto_url, supabase);
      return { ...r, military: { ...military, foto_url } };
    })
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Pendências Remotas</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Solicitações de armamento — aprove, rejeite ou confirme a entrega
        </p>
      </div>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <SolicitacoesClient initialRequests={resolvedRequests as any} hasMore={hasMore} currentLimit={limit} />
    </div>
  );
}
