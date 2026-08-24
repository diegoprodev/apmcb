
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, getSessionProfile } from "@/lib/session-profile";
import { redirect } from "next/navigation";
import { AprovacaoClient } from "./_aprovacao-client";

export default async function SolicitacoesPage() {
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // profile e session são independentes (session não depende do profile) —
  // buscados em paralelo em vez de sequencial.
  const [profile, { data: { session } }] = await Promise.all([
    getSessionProfile(user.id),
    supabase.auth.getSession(),
  ]);
  if (profile?.role !== "admin_reserva" && profile?.role !== "admin_global") redirect("/");

  const bffUrl = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";
  const authHeaders: Record<string, string> = session?.access_token
    ? { Authorization: `Bearer ${session.access_token}` }
    : {};

  // Solicitações de material (admin_approval_requests) e de categoria
  // (category_requests) são duas tabelas/endpoints distintos no BFF — ver
  // apps/bff/src/routes/{arsenal,categories}.ts. Buscadas em paralelo e
  // mescladas abaixo numa lista única para que o admin revise as duas classes
  // de solicitação nas mesmas abas (Pendentes/Aprovadas/Rejeitadas/Histórico)
  // em vez de precisar visitar duas telas separadas.
  const [materialRes, categoryRes] = await Promise.all([
    fetch(`${bffUrl}/api/arsenal/requests?status=all`, { headers: authHeaders, cache: "no-store" }),
    fetch(`${bffUrl}/api/categories/requests`, { headers: authHeaders, cache: "no-store" }),
  ]);
  const materialRequests = materialRes.ok ? await materialRes.json() : [];
  const categoryRequests = categoryRes.ok ? ((await categoryRes.json()).requests ?? []) : [];

  // Supabase returns joined tables as arrays; flatten to single objects
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const normalizedMaterial = (materialRequests ?? []).map((r: any) => ({
    ...r,
    source: "material" as const,
    requestor: Array.isArray(r.requestor) ? r.requestor[0] ?? null : r.requestor,
    material: Array.isArray(r.material) ? r.material[0] ?? null : r.material,
    reviewer: Array.isArray(r.reviewer) ? r.reviewer[0] ?? null : r.reviewer,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const normalizedCategory = (categoryRequests ?? []).map((r: any) => {
    const reserve = Array.isArray(r.reserve) ? r.reserve[0] ?? null : r.reserve;
    return {
      id: r.id,
      source: "category" as const,
      status: r.status,
      created_at: r.created_at,
      reviewed_at: r.reviewed_at,
      nome: r.nome,
      slug: r.slug,
      icon: r.icon,
      description: r.description,
      rejection_reason: r.rejection_reason,
      // admin_global agora enxerga solicitações de VÁRIAS reservas do
      // tenant na mesma lista (correção de escopo em categories.ts) — sem o
      // nome da reserva na UI, duas solicitações homônimas de reservas
      // diferentes ("Nova categoria: Munição") ficam indistinguíveis
      // (achado de code review, 2ª rodada).
      reserveNome: (reserve?.nome as string | undefined) ?? null,
      requestor: Array.isArray(r.requested_by) ? r.requested_by[0] ?? null : r.requested_by,
      reviewer: Array.isArray(r.reviewed_by) ? r.reviewed_by[0] ?? null : r.reviewed_by,
    };
  });

  const normalized = [...normalizedMaterial, ...normalizedCategory].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Solicitações de Armeiro</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Aprovação de ajustes, adições e desativações de material, e de novas categorias, solicitadas por armeiros
        </p>
      </div>

      <AprovacaoClient requests={normalized} />
    </div>
  );
}
