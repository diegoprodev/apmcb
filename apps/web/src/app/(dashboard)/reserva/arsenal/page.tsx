import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Package, TrendingDown, AlertTriangle, CheckCircle2 } from "lucide-react";
import { ArsenalClient } from "./_arsenal-client";
import type { MaterialItem } from "@/components/arsenal/material-detail-sheet";
import type { MaterialCategoryProfile } from "@/lib/material-metadata";
import { MyRequestsBanner } from "./_my-requests-banner";
import { AddMaterialButton } from "@/app/(dashboard)/admin/arsenal/_arsenal-actions";
import { CategoryManager } from "@/app/(dashboard)/admin/arsenal/_category-manager";
import { AddMaterialRequestButton } from "./_add-material-request-button";

type MaterialAvailabilityRow = {
  id: string;
  nome: string;
  categoria: string | null;
  categoria_slug?: string | null;
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
    .select("role")
    .eq("id", user.id)
    .single();

  const role = profile?.role;
  if (role !== "armeiro" && role !== "admin_global" && role !== "admin_reserva") redirect("/");
  const canRequest = role === "armeiro";
  const canManageDirectly = role === "admin_reserva";
  const canReviewRequests = role === "admin_reserva";
  const activeTab = params?.tab === "categorias" && (canRequest || canManageDirectly) ? "categorias" : "materiais";

  const materialSelect = "id, nome, categoria, categoria_slug, descricao, calibre, has_serial_numbers, requires_validity, requires_vehicle_fields, validity_alert_days, vehicle_plate, vehicle_color, vehicle_year, vehicle_model, quantidade_disponivel, quantidade_total, quantidade_armada";
  const fallbackMaterialSelect = "id, nome, categoria, quantidade_disponivel, quantidade_total, quantidade_armada";
  let materialResult = (await supabase
    .from("material_availability")
    .select(`${materialSelect}, photo_url`)
    .order("categoria")
    .order("nome")) as MaterialAvailabilityResult;

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

  const { data: categories } = await supabase
    .from("material_categories")
    .select(`
      id, nome, slug, description, requires_caliber, requires_validity,
      default_has_serial_numbers, validity_alert_days, requires_vehicle_fields
    `)
    .eq("active", true)
    .order("nome");

  const materiais = materialResult.data ?? [];
  const categoryRows = (categories ?? []) as MaterialCategoryProfile[];

  const items: MaterialItem[] = materiais.map((m) => ({
    id: m.id,
    nome: m.nome,
    categoria: m.categoria ?? "outro",
    categoria_slug: m.categoria_slug ?? null,
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
  }));

  const totalItens = items.length;
  const disponiveis = items.filter((m) => m.quantidade_disponivel > 0).length;
  const esgotados = items.filter((m) => m.quantidade_disponivel === 0).length;
  const baixoEstoque = items.filter(
    (m) => m.quantidade_disponivel > 0 && m.quantidade_disponivel <= Math.ceil(m.quantidade_total * 0.2)
  ).length;
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

  const { data: ownRequests } = canRequest
    ? await supabase
        .from("admin_approval_requests")
        .select("id, type, status, payload, admin_note, created_at, reviewed_at")
        .eq("requestor_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10)
    : { data: null };

  return (
    <div className="space-y-6">
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
        <CategoryManager initialCategories={categoryRows} canManage={canManageDirectly} />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard label="Total de itens" value={totalItens} icon={<Package className="size-4" />} color="blue" />
            <KpiCard label="Disponiveis" value={disponiveis} icon={<CheckCircle2 className="size-4" />} color="green" />
            <KpiCard label="Baixo estoque" value={baixoEstoque} icon={<TrendingDown className="size-4" />} color="amber" />
            <KpiCard label="Esgotados" value={esgotados} icon={<AlertTriangle className="size-4" />} color="red" />
          </div>

          {canRequest && ownRequests && ownRequests.length > 0 && <MyRequestsBanner requests={ownRequests} />}

          <ArsenalClient items={items} canRequest={canRequest} canManageDirectly={canManageDirectly} />
        </>
      )}
    </div>
  );
}

function KpiCard({
  label, value, icon, color,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: "blue" | "green" | "amber" | "red";
}) {
  const colorMap = {
    blue:  { bg: "bg-primary/10",     text: "text-primary",     num: "text-primary" },
    green: { bg: "bg-emerald-100",    text: "text-emerald-700", num: "text-emerald-700" },
    amber: { bg: "bg-amber-100",      text: "text-amber-700",   num: "text-amber-700" },
    red:   { bg: "bg-destructive/10", text: "text-destructive", num: "text-destructive" },
  };
  const c = colorMap[color];
  return (
    <div className="rounded-2xl bg-card p-4 space-y-2" style={{ boxShadow: "var(--shadow-card)" }}>
      <div className={`size-8 rounded-xl ${c.bg} ${c.text} flex items-center justify-center`}>{icon}</div>
      <p className={`text-2xl font-bold ${c.num}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
