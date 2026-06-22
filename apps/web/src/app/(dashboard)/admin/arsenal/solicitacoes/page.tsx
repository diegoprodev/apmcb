export const runtime = 'edge';

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AprovacaoClient } from "./_aprovacao-client";

export default async function SolicitacoesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin_global" && profile?.role !== "superadmin") redirect("/");

  const { data: requests } = await supabase
    .from("admin_approval_requests")
    .select(`
      id, type, status, payload, admin_note, created_at, reviewed_at,
      requestor:requestor_id(id, nome_completo, posto, matricula),
      material:material_type_id(id, nome, categoria),
      reviewer:reviewed_by(id, nome_completo)
    `)
    .order("created_at", { ascending: false });

  // Supabase returns joined tables as arrays; flatten to single objects
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const normalized = (requests ?? []).map((r: any) => ({
    ...r,
    requestor: Array.isArray(r.requestor) ? r.requestor[0] ?? null : r.requestor,
    material: Array.isArray(r.material) ? r.material[0] ?? null : r.material,
    reviewer: Array.isArray(r.reviewer) ? r.reviewer[0] ?? null : r.reviewer,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Solicitações de Armeiro</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Aprovação de ajustes de estoque e adição de materiais
        </p>
      </div>

      <AprovacaoClient requests={normalized} />
    </div>
  );
}
