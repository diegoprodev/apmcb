export const runtime = 'edge';

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SolicitacoesClient } from "./_solicitacoes-client";

export default async function SolicitacoesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "master" && profile?.role !== "admin") redirect("/");

  const { data: requests } = await supabase
    .from("material_requests")
    .select(`
      id, status, notes, denial_reason, armeiro_nota,
      totp_validated, requested_at, approved_at,
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
    .limit(50);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Pendências Remotas</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Solicitações de armamento — aprove, rejeite ou confirme a entrega
        </p>
      </div>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <SolicitacoesClient initialRequests={(requests ?? []) as any} />
    </div>
  );
}
