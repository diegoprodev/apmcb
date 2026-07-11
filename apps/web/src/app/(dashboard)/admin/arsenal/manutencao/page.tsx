export const runtime = "edge";

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchManutencaoItems } from "@/lib/material-items-manutencao";
import { TAB_LABEL, TAB_ORDER, TAB_STATUSES, type ManutencaoTab } from "@/lib/material-item-status";
import { ManutencaoClient } from "@/app/(dashboard)/reserva/arsenal/manutencao/_manutencao-client";
import { RegistrarOcorrenciaButton } from "@/app/(dashboard)/reserva/arsenal/manutencao/_registrar-ocorrencia-dialog";

function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </Link>
  );
}

function tabHref(tab: ManutencaoTab) {
  return tab === "danificados" ? "/admin/arsenal/manutencao" : `/admin/arsenal/manutencao?tab=${tab}`;
}

export default async function AdminManutencaoPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const params = await searchParams;
  const activeTab: ManutencaoTab =
    params?.tab === "perdidos" || params?.tab === "administrativo" ? params.tab : "danificados";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, default_tenant_id")
    .eq("id", user.id)
    .single();

  // admin_global é a única role desta rota — armeiro/admin_reserva usam
  // /reserva/arsenal/manutencao (mesmo dado, sem o filtro cross-reserva).
  // superadmin deliberadamente de fora (Privilege Ceiling H-RBAC — não incluir
  // superadmin em guards de reserva/estrutura).
  if (profile?.role !== "admin_global") redirect("/");
  if (!profile.default_tenant_id) redirect("/");

  const [allRows, reservesResult] = await Promise.all([
    fetchManutencaoItems(supabase, profile.default_tenant_id),
    supabase
      .from("reserves")
      .select("id, nome, acronym")
      .eq("tenant_id", profile.default_tenant_id)
      .eq("status", "ativa")
      .order("nome"),
  ]);

  const rowsByTab = Object.fromEntries(
    TAB_ORDER.map((tab) => [tab, allRows.filter((r) => (TAB_STATUSES[tab] as string[]).includes(r.status_operacional))])
  ) as Record<ManutencaoTab, typeof allRows>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Manutenção</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Materiais danificados, perdidos ou em pendência administrativa em todas as reservas do tenant.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div aria-label="Secoes de manutencao" className="inline-flex h-9 items-center rounded-lg border border-border bg-card p-1">
            {TAB_ORDER.map((tab) => (
              <TabLink key={tab} href={tabHref(tab)} active={activeTab === tab}>
                {TAB_LABEL[tab]} ({rowsByTab[tab].length})
              </TabLink>
            ))}
          </div>
          <RegistrarOcorrenciaButton />
        </div>
      </div>

      <ManutencaoClient rows={rowsByTab[activeTab]} reserves={reservesResult.data ?? []} activeTabLabel={activeTab} />
    </div>
  );
}
