import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Package, TrendingDown, AlertTriangle, CheckCircle2 } from "lucide-react";
import { withMaterialPhotoDisplayUrls } from "@/lib/storage";
import { withMaterialTypesCount } from "@/lib/category-usage";
import { ArsenalClient } from "./_arsenal-client";
import { getMaterialStockStatus, type ArsenalMaterialItem } from "@/lib/arsenal-status";
import type { MaterialCategoryProfile } from "@/lib/material-metadata";
import { MyRequestsBanner } from "./_my-requests-banner";
import { ReviewRequestsAccordion } from "./_review-requests-accordion";
import { AddMaterialButton } from "@/app/(dashboard)/admin/arsenal/_arsenal-actions";
import { CategoryManager } from "@/app/(dashboard)/admin/arsenal/_category-manager";
import { AddMaterialRequestButton } from "./_add-material-request-button";
import { RealtimeArsenalSync } from "@/components/arsenal/realtime-arsenal-sync";

type MaterialAvailabilityRow = {
  id: string;
  nome: string;
  categoria: string | null;
  categoria_slug?: string | null;
  category_id?: string | null;
  descricao?: string | null;
  calibre?: string | null;
  has_serial_numbers?: boolean | null;
  requires_validity?: boolean | null;
  requires_vehicle_fields?: boolean | null;
  validity_alert_days?: number[] | null;
  vehicle_plate?: string | null;
  vehicle_color?: string | null;
  vehicle_year?: number | null;
  vehicle_model?: string | null;
  quantidade_disponivel: number | null;
  quantidade_total: number | null;
  quantidade_armada: number | null;
  photo_url?: string | null;
  cautela_habilitada?: boolean | null;
  quantidade_cautela?: number | null;
};

type MaterialAvailabilityResult = {
  data: MaterialAvailabilityRow[] | null;
  error: { message: string } | null;
};

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

export default async function AlmoxarifadoPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, default_tenant_id")
    .eq("id", user.id)
    .single();

  const role = profile?.role;
  if (role !== "armeiro" && role !== "admin_global" && role !== "admin_reserva") redirect("/");
  const canRequest = role === "armeiro";
  const canManageDirectly = role === "admin_reserva";
  const canReviewRequests = role === "admin_reserva" || role === "admin_global";
  const activeTab = params?.tab === "categorias" && (canRequest || canManageDirectly) ? "categorias" : "materiais";

  const materialSelect = "id, nome, categoria, categoria_slug, category_id, descricao, calibre, has_serial_numbers, requires_validity, requires_vehicle_fields, validity_alert_days, vehicle_plate, vehicle_color, vehicle_year, vehicle_model, quantidade_disponivel, quantidade_total, quantidade_armada, cautela_habilitada, quantidade_cautela";
  const fallbackMaterialSelect = "id, nome, categoria, quantidade_disponivel, quantidade_total, quantidade_armada";

  // materialResult, categories e inactiveCategoryRows são independentes —
  // buscados em paralelo. O fallback de materialResult só roda
  // sequencialmente no caso raro de erro. inactiveCategoryRows é uma
  // consulta separada e enxuta (só id) das categorias DESATIVADAS — usada
  // apenas para o indicador "categoria desativada" nos materiais abaixo, não
  // reaproveita/altera a consulta `categories` (que CategoryManager espera
  // conter só categorias ativas).
  const [materialResultInitial, { data: categories }, { data: inactiveCategoryRows }] = await Promise.all([
    supabase
      .from("material_availability")
      .select(`${materialSelect}, photo_url`)
      .order("categoria")
      .order("nome") as unknown as Promise<MaterialAvailabilityResult>,
    supabase
      .from("material_categories")
      .select(`
        id, nome, slug, description, requires_caliber, requires_validity,
        default_has_serial_numbers, validity_alert_days, requires_vehicle_fields
      `)
      .eq("active", true)
      .order("nome"),
    supabase
      .from("material_categories")
      .select("id")
      .eq("active", false),
  ]);

  let materialResult = materialResultInitial;
  if (materialResult.error?.message.includes("photo_url")) {
    materialResult = (await supabase
      .from("material_availability")
      .select(fallbackMaterialSelect)
      .order("categoria")
      .order("nome")) as MaterialAvailabilityResult;
  } else if (materialResult.error) {
    materialResult = (await supabase
      .from("material_availability")
      .select(`${fallbackMaterialSelect}, photo_url`)
      .order("categoria")
      .order("nome")) as MaterialAvailabilityResult;
  }

  const materiais = await withMaterialPhotoDisplayUrls(materialResult.data ?? [], supabase);
  const categoryRows = (categories ?? []) as MaterialCategoryProfile[];
  const inactiveCategoryIds = new Set((inactiveCategoryRows ?? []).map((r) => r.id as string));
  // Mesmo padrão de admin/arsenal/page.tsx: só busca a contagem de
  // material_types em uso quando a aba Categorias está ativa (CategoryManager
  // é o mesmo componente renderizado nas duas páginas) — evita a query extra
  // na aba Materiais, a mais visitada desta rota.
  const categoryRowsForManager = activeTab === "categorias"
    ? await withMaterialTypesCount(categoryRows, supabase)
    : categoryRows;

  // Contagem de itens físicos (material_items) em uso ativo (em_saida |
  // cautelado) por material_type — mesma fonte/critério usado pelo BFF em
  // DELETE /api/arsenal/:id para decidir o 409. Buscada numa única query (não
  // N+1) e usada tanto para o aviso de hover antes de desativar quanto para
  // desabilitar o botão de desativação client-side.
  const materialTypeIds = materiais.map((m) => m.id);
  const { data: activeUseRows } = materialTypeIds.length > 0
    ? await supabase
        .from("material_items")
        .select("material_type_id")
        .in("material_type_id", materialTypeIds)
        .in("status_operacional", ["em_saida", "cautelado"])
    : { data: [] as { material_type_id: string }[] };

  const activeUseCountByType = new Map<string, number>();
  for (const row of activeUseRows ?? []) {
    const key = row.material_type_id as string;
    activeUseCountByType.set(key, (activeUseCountByType.get(key) ?? 0) + 1);
  }

  const items: ArsenalMaterialItem[] = materiais.map((m) => ({
    id: m.id,
    nome: m.nome,
    categoria: m.categoria ?? "outro",
    categoria_slug: m.categoria_slug ?? null,
    category_id: m.category_id ?? null,
    descricao: m.descricao ?? null,
    calibre: m.calibre ?? null,
    has_serial_numbers: m.has_serial_numbers ?? false,
    requires_validity: m.requires_validity ?? false,
    requires_vehicle_fields: m.requires_vehicle_fields ?? false,
    validity_alert_days: m.validity_alert_days ?? [],
    vehicle_plate: m.vehicle_plate ?? null,
    vehicle_color: m.vehicle_color ?? null,
    vehicle_year: m.vehicle_year ?? null,
    vehicle_model: m.vehicle_model ?? null,
    quantidade_total: m.quantidade_total ?? 0,
    quantidade_disponivel: m.quantidade_disponivel ?? 0,
    quantidade_armada: m.quantidade_armada ?? 0,
    photo_url: m.photo_url ?? null,
    photo_display_url: m.photo_display_url ?? null,
    cautela_habilitada: m.cautela_habilitada ?? false,
    quantidade_cautela: m.quantidade_cautela ?? 0,
    quantidade_em_uso_fisico: activeUseCountByType.get(m.id) ?? 0,
    categoria_ativa: m.category_id ? !inactiveCategoryIds.has(m.category_id) : true,
  }));

  // Única fonte de verdade para "o que conta como baixo estoque/esgotado" —
  // getMaterialStockStatus (lib/arsenal-status.ts) é o MESMO cálculo que
  // _arsenal-client.tsx usa para filtrar a lista, então a contagem exibida
  // aqui sempre bate com o que o filtro correspondente mostra depois do
  // clique no card (ver KpiCard abaixo).
  const totalItens = items.length;
  const disponiveis = items.filter((m) => getMaterialStockStatus(m) === "ok").length;
  const baixoEstoque = items.filter((m) => getMaterialStockStatus(m) === "baixo").length;
  const esgotados = items.filter((m) => getMaterialStockStatus(m) === "esgotado").length;
  const showTabs = canRequest || canManageDirectly;
  const tabs = showTabs ? (
    <div
      aria-label="Secoes do almoxarifado"
      className="inline-flex h-9 items-center rounded-lg border border-border bg-card p-1"
    >
      <TabLink href="/reserva/arsenal" active={activeTab === "materiais"}>Materiais</TabLink>
      <TabLink href="/reserva/arsenal?tab=categorias" active={activeTab === "categorias"}>Categorias</TabLink>
    </div>
  ) : null;

  // category_requests é um fluxo de aprovação paralelo ao de
  // admin_approval_requests (tabela própria, ver apps/bff/src/routes/categories.ts)
  // — buscado em paralelo e mesclado abaixo para que o armeiro veja as duas
  // classes de solicitação no mesmo painel "Minhas solicitações". RLS
  // (`requested_by = auth.uid()`) escopa este SELECT automaticamente, igual
  // ao filtro explícito .eq("requestor_id", user.id) usado para materiais.
  const [{ data: ownMaterialRequests }, { data: ownCategoryRequests }] = canRequest
    ? await Promise.all([
        supabase
          .from("admin_approval_requests")
          .select("id, type, status, payload, admin_note, created_at, reviewed_at")
          .eq("requestor_id", user.id)
          .order("created_at", { ascending: false })
          .limit(10),
        supabase
          .from("category_requests")
          .select("id, nome, icon, description, status, rejection_reason, created_at, reviewed_at, type")
          .eq("requested_by", user.id)
          .order("created_at", { ascending: false })
          .limit(10),
      ])
    : [{ data: null }, { data: null }];

  const ownRequests = canRequest
    ? [
        ...(ownMaterialRequests ?? []).map((r) => ({ ...r, source: "material" as const })),
        ...(ownCategoryRequests ?? []).map((r) => ({ ...r, source: "category" as const })),
      ]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 10)
    : [];

  const [{ count: pendingMaterialCount }, { count: pendingCategoryCount }] = canReviewRequests
    ? await Promise.all([
        supabase
          .from("admin_approval_requests")
          .select("*", { count: "exact", head: true })
          .eq("status", "pendente"),
        supabase
          .from("category_requests")
          .select("*", { count: "exact", head: true })
          .eq("status", "pendente"),
      ])
    : [{ count: null }, { count: null }];
  const pendingReviewCount = (pendingMaterialCount ?? 0) + (pendingCategoryCount ?? 0);

  return (
    <div className="space-y-6">
      {profile?.default_tenant_id && <RealtimeArsenalSync tenantId={profile.default_tenant_id} />}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Almoxarifado</h2>
          <p className="text-muted-foreground text-sm mt-1">Inventario completo de materiais e disponibilidade</p>
        </div>
        {(canRequest || canManageDirectly || canReviewRequests) && (
          <div className="flex flex-wrap items-center gap-2">
            {canRequest && <AddMaterialRequestButton />}
            {canManageDirectly && <AddMaterialButton categories={categoryRows} />}
            {canReviewRequests && (
              <Link
                href="/admin/arsenal/solicitacoes"
                className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-3 text-[0.8rem] font-medium hover:border-primary/40 hover:bg-primary/5"
              >
                Aprovacoes
              </Link>
            )}
          </div>
        )}
      </div>

      {tabs}

      {activeTab === "categorias" ? (
        <CategoryManager initialCategories={categoryRowsForManager} canManage={canManageDirectly} canRequest={canRequest} />
      ) : (
        <>
          {/* Cards clicáveis — levam à mesma lista abaixo já filtrada por
              estoque (ArsenalClient lê ?estoque= via useSearchParams, mesmo
              padrão de _historico-client.tsx para ?status=). "Total de itens"
              não define ?estoque= (equivale a stockFilter="all"). */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard
              label="Total de itens" value={totalItens} icon={<Package className="size-4" />} color="blue"
              href="/reserva/arsenal?tab=materiais" testId="kpi-total-itens"
            />
            <KpiCard
              label="Disponiveis" value={disponiveis} icon={<CheckCircle2 className="size-4" />} color="green"
              href="/reserva/arsenal?tab=materiais&estoque=ok" testId="kpi-disponiveis"
            />
            <KpiCard
              label="Baixo estoque" value={baixoEstoque} icon={<TrendingDown className="size-4" />} color="amber"
              href="/reserva/arsenal?tab=materiais&estoque=baixo" testId="kpi-baixo-estoque"
            />
            <KpiCard
              label="Esgotados" value={esgotados} icon={<AlertTriangle className="size-4" />} color="red"
              href="/reserva/arsenal?tab=materiais&estoque=esgotado" testId="kpi-esgotados"
            />
          </div>

          {canRequest && ownRequests.length > 0 && <MyRequestsBanner requests={ownRequests} />}
          {canReviewRequests && <ReviewRequestsAccordion pendingCount={pendingReviewCount} />}

          <ArsenalClient items={items} canRequest={canRequest} canManageDirectly={canManageDirectly} />
        </>
      )}
    </div>
  );
}

function KpiCard({
  label, value, icon, color, href, testId,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: "blue" | "green" | "amber" | "red";
  href: string;
  testId: string;
}) {
  const colorMap = {
    blue:  { bg: "bg-primary/10",     text: "text-primary",     num: "text-primary" },
    green: { bg: "bg-emerald-100",    text: "text-emerald-700", num: "text-emerald-700" },
    amber: { bg: "bg-amber-100",      text: "text-amber-700",   num: "text-amber-700" },
    red:   { bg: "bg-destructive/10", text: "text-destructive", num: "text-destructive" },
  };
  const c = colorMap[color];
  return (
    <Link
      href={href}
      data-testid={testId}
      title={`Ver ${label.toLowerCase()}`}
      className="block rounded-2xl bg-card p-4 space-y-2 text-left transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className={`size-8 rounded-xl ${c.bg} ${c.text} flex items-center justify-center`}>{icon}</div>
      <p className={`text-2xl font-bold ${c.num}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </Link>
  );
}
