export const runtime = 'edge';

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Package, TrendingDown, AlertTriangle, CheckCircle2 } from "lucide-react";
import { ArsenalClient } from "./_arsenal-client";
import type { MaterialItem } from "@/components/arsenal/material-detail-sheet";
import { MyRequestsBanner } from "./_my-requests-banner";

export default async function AlmoxarifadoPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const role = profile?.role;
  if (role !== "master" && role !== "admin") redirect("/");

  const { data: materiais } = await supabase
    .from("material_availability")
    .select("id, nome, categoria, quantidade_disponivel, quantidade_total, quantidade_armada")
    .order("categoria")
    .order("nome");

  const items: MaterialItem[] = (materiais ?? []).map((m) => ({
    id: m.id,
    nome: m.nome,
    categoria: m.categoria ?? "outro",
    quantidade_total: m.quantidade_total ?? 0,
    quantidade_disponivel: m.quantidade_disponivel ?? 0,
    quantidade_armada: m.quantidade_armada ?? 0,
  }));

  const totalItens = items.length;
  const disponiveis = items.filter((m) => m.quantidade_disponivel > 0).length;
  const esgotados = items.filter((m) => m.quantidade_disponivel === 0).length;
  const baixoEstoque = items.filter(
    (m) => m.quantidade_disponivel > 0 && m.quantidade_disponivel <= Math.ceil(m.quantidade_total * 0.2)
  ).length;

  // armeiro (master) can request admin approval; admin views read-only here
  const canRequest = role === "master";

  // Fetch own approval requests (armeiro only)
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
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Almoxarifado</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Inventário completo de materiais e disponibilidade
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total de itens" value={totalItens} icon={<Package className="size-4" />} color="blue" />
        <KpiCard label="Disponíveis" value={disponiveis} icon={<CheckCircle2 className="size-4" />} color="green" />
        <KpiCard label="Baixo estoque" value={baixoEstoque} icon={<TrendingDown className="size-4" />} color="amber" />
        <KpiCard label="Esgotados" value={esgotados} icon={<AlertTriangle className="size-4" />} color="red" />
      </div>

      {/* Own requests banner (armeiro only) */}
      {canRequest && ownRequests && ownRequests.length > 0 && (
        <MyRequestsBanner requests={ownRequests} />
      )}

      {/* Interactive list with filters */}
      <ArsenalClient items={items} canRequest={canRequest} />
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
