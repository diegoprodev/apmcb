import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle, Clock, Package } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { MaterialCategoryProfile } from "@/lib/material-metadata";
import { AddMaterialButton } from "./_arsenal-actions";
import { ArsenalTable as AlmoxarifadoTable } from "./_arsenal-filters";
import { CategoryManager } from "./_category-manager";

type MaterialAvailability = {
  id: string;
  category_id?: string | null;
  nome: string;
  categoria: string;
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
  quantidade_total: number;
  quantidade_disponivel: number;
  quantidade_armada: number;
  photo_url?: string | null;
};

function KpiCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: "blue" | "success" | "warning";
}) {
  const iconStyle: Record<string, React.CSSProperties> = {
    blue: { backgroundColor: "rgba(27,58,140,0.08)", color: "#1B3A8C" },
    success: { backgroundColor: "#DCFCE7", color: "#166534" },
    warning: { backgroundColor: "#FEF3C7", color: "#92400E" },
  };

  return (
    <div
      className="space-y-3 rounded-2xl bg-card p-5 transition-all hover:-translate-y-0.5"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex size-9 items-center justify-center rounded-xl" style={iconStyle[color]}>
        {icon}
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-2xl font-bold tracking-tight">{value}</p>
      </div>
    </div>
  );
}

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
  const activeTab = params?.tab === "categorias" ? "categorias" : "materiais";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin_global" && profile?.role !== "admin_reserva") redirect("/");
  const canManageMaterials = profile.role === "admin_reserva";

  const [{ data: materials }, { count: totalTipos }, { data: categories }] = await Promise.all([
    supabase.from("material_availability").select("*").order("nome"),
    supabase.from("material_types").select("*", { count: "exact", head: true }),
    supabase
      .from("material_categories")
      .select(`
        id, nome, slug, description, requires_caliber, requires_validity,
        default_has_serial_numbers, validity_alert_days, requires_vehicle_fields
      `)
      .eq("active", true)
      .order("nome"),
  ]);

  const rows = (materials ?? []) as MaterialAvailability[];
  const categoryRows = (categories ?? []) as MaterialCategoryProfile[];
  const totalDisponivel = rows.reduce((sum, m) => sum + (m.quantidade_disponivel ?? 0), 0);
  const totalEmUso = rows.reduce((sum, m) => sum + (m.quantidade_armada ?? 0), 0);

  const tabs = (
    <div aria-label="Secoes do almoxarifado" className="inline-flex h-9 items-center rounded-lg border border-border bg-card p-1">
      <TabLink href="/admin/arsenal" active={activeTab === "materiais"}>Materiais</TabLink>
      <TabLink href="/admin/arsenal?tab=categorias" active={activeTab === "categorias"}>Categorias</TabLink>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Almoxarifado</h2>
          <p className="mt-1 text-sm text-muted-foreground">Controle de estoque, materiais e categorias.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tabs}
          {canManageMaterials ? <AddMaterialButton categories={categoryRows} /> : null}
        </div>
      </div>

      {activeTab === "materiais" ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KpiCard icon={<Package className="size-5" />} label="Total de materiais" value={totalTipos ?? 0} color="blue" />
            <KpiCard icon={<CheckCircle className="size-5" />} label="Unidades disponiveis" value={totalDisponivel} color="success" />
            <KpiCard icon={<Clock className="size-5" />} label="Unidades em uso" value={totalEmUso} color="warning" />
          </div>

          <AlmoxarifadoTable rows={rows} categories={categoryRows} />
        </>
      ) : (
        <CategoryManager initialCategories={categoryRows} canManage={canManageMaterials} />
      )}
    </div>
  );
}
