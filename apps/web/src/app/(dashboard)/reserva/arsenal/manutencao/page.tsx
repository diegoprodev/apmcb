export const runtime = "edge";

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session-profile";
import { BFF_URL, bffSessionHeaders, resolveWebSessionRole } from "@/lib/web-session";
import { TAB_LABEL, TAB_ORDER, TAB_STATUSES, type ManutencaoTab } from "@/lib/material-item-status";
import type { ManutencaoRow } from "@/lib/material-items-manutencao";
import { ManutencaoClient } from "./_manutencao-client";
import { RegistrarOcorrenciaButton } from "./_registrar-ocorrencia-dialog";

// Mesmos papéis de antes e do roleGuard de GET /api/arsenal/items/manutencao.
// admin_global usa /admin/arsenal/manutencao (fora deste lote); superadmin fora
// de propósito (H-RBAC).
const STAFF_ROLES = new Set(["armeiro", "admin_reserva"]);

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
  return tab === "danificados" ? "/reserva/arsenal/manutencao" : `/reserva/arsenal/manutencao?tab=${tab}`;
}

// R-34 / R-37 lote 6 (docs/auditoria/EVIDENCE_R37_BATCH6.md): antes autorizava por
// `profiles.role` e lia `material_items` direto do Supabase com o JWT do usuário
// (RLS; ignora o Modo Usuário — D-02) para o tenant inteiro. Agora: papel EFETIVO
// da sessão do BFF e itens de GET /api/arsenal/items/manutencao (tenant e reserva
// da sessão, escopo no banco). Nada de Supabase direto. Registrar ocorrência
// (escrita) continua nos componentes/rotas de sempre.
export default async function ManutencaoPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const params = await searchParams;
  const activeTab: ManutencaoTab =
    params?.tab === "perdidos" || params?.tab === "administrativo" ? params.tab : "danificados";

  const user = await getSessionUser();
  if (!user) redirect("/login");

  // null = sem sessão do BFF, sessão de outra identidade ou falha → nega.
  const role = await resolveWebSessionRole(user.id);
  if (!role || !STAFF_ROLES.has(role)) redirect("/");

  const allRows = await fetchManutencaoRows();

  const header = (
    <div>
      <h2 className="text-2xl font-bold tracking-tight">Manutenção</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Materiais danificados, perdidos ou em pendência administrativa — fora de operação até regularização.
      </p>
    </div>
  );

  if (!allRows) {
    return (
      <div className="space-y-6">
        {header}
        <div className="rounded-2xl bg-card p-10 text-center" style={{ boxShadow: "var(--shadow-card)" }}>
          <p className="text-sm font-medium text-foreground">Não foi possível carregar os itens em manutenção</p>
          <p className="mt-1 text-xs text-muted-foreground">Tente novamente em instantes.</p>
        </div>
      </div>
    );
  }

  const rowsByTab = Object.fromEntries(
    TAB_ORDER.map((tab) => [tab, allRows.filter((r) => (TAB_STATUSES[tab] as string[]).includes(r.status_operacional))])
  ) as Record<ManutencaoTab, ManutencaoRow[]>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        {header}
        <div className="flex flex-wrap items-center gap-2">
          <div aria-label="Secoes de manutencao" className="inline-flex h-9 items-center rounded-lg border border-border bg-card p-1">
            {TAB_ORDER.map((tab) => (
              <TabLink key={tab} href={tabHref(tab)} active={activeTab === tab}>
                {TAB_LABEL[tab]} ({rowsByTab[tab].length})
              </TabLink>
            ))}
          </div>
          <RegistrarOcorrenciaButton role={role} />
        </div>
      </div>

      <ManutencaoClient rows={rowsByTab[activeTab]} activeTabLabel={activeTab} />
    </div>
  );
}

// Toda negação/falha deixa rastro no log. 401 → login; 403 (papel caiu) → home;
// demais falhas → null (a página mostra aviso; nunca lista vazia).
async function fetchManutencaoRows(): Promise<ManutencaoRow[] | null> {
  let res: Response;
  try {
    res = await fetch(`${BFF_URL}/api/arsenal/items/manutencao`, {
      headers: await bffSessionHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    console.warn("[reserva/arsenal/manutencao] falha ao consultar /api/arsenal/items/manutencao", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
  const requestId = res.headers.get("x-request-id");
  if (res.status === 401) {
    console.warn("[reserva/arsenal/manutencao] BFF recusou /api/arsenal/items/manutencao", { status: 401, requestId });
    redirect("/login");
  }
  if (res.status === 403) {
    console.warn("[reserva/arsenal/manutencao] BFF negou /api/arsenal/items/manutencao", { status: 403, requestId });
    redirect("/");
  }
  if (!res.ok) {
    console.warn("[reserva/arsenal/manutencao] BFF recusou /api/arsenal/items/manutencao", { status: res.status, requestId });
    return null;
  }
  const body = (await res.json().catch(() => null)) as { items?: unknown } | null;
  if (!body || !Array.isArray(body.items)) {
    console.warn("[reserva/arsenal/manutencao] resposta inesperada de /api/arsenal/items/manutencao", { requestId });
    return null;
  }
  return (body.items as unknown[])
    .filter((r): r is Record<string, unknown> & { id: string } => !!r && typeof (r as { id?: unknown }).id === "string")
    .map((r) => ({
      id: r.id,
      status_operacional: r.status_operacional as ManutencaoRow["status_operacional"],
      identificador_principal: r.identificador_principal as string,
      tipo_identificador: r.tipo_identificador as string,
      condicao: r.condicao as string,
      descricao_adicional: (r.descricao_adicional as string | null) ?? null,
      last_movement_at: r.last_movement_at as string,
      material_nome: (r.material_nome as string | null) ?? "Material",
      material_categoria: (r.material_categoria as string | null) ?? "outro",
      reserve_id: (r.reserve_id as string | null) ?? null,
      reserve_nome: (r.reserve_nome as string | null) ?? null,
    }));
}
