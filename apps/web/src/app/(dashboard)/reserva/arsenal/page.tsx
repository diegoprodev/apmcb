export const runtime = 'edge';

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Package, TrendingDown, AlertTriangle, CheckCircle2 } from "lucide-react";

const CATEGORIA_LABEL: Record<string, string> = {
  arma: "Arma",
  farda: "Farda",
  acessorio: "Acessório",
  equipamento: "Equipamento",
};

export default async function AlmoxarifadoPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "master" && profile?.role !== "admin") redirect("/");

  const { data: materiais } = await supabase
    .from("material_availability")
    .select("id, nome, categoria, quantidade_disponivel, quantidade_total, quantidade_armada")
    .order("categoria")
    .order("nome");

  const items = materiais ?? [];
  const totalItens = items.length;
  const disponiveis = items.filter((m) => m.quantidade_disponivel > 0).length;
  const esgotados = items.filter((m) => m.quantidade_disponivel === 0).length;
  const baixoEstoque = items.filter(
    (m) => m.quantidade_disponivel > 0 && m.quantidade_disponivel <= Math.ceil(m.quantidade_total * 0.2)
  ).length;

  // Agrupar por categoria
  const grouped = items.reduce<Record<string, typeof items>>((acc, m) => {
    const cat = m.categoria ?? "outros";
    acc[cat] = acc[cat] ?? [];
    acc[cat].push(m);
    return acc;
  }, {});

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
        <KpiCard
          label="Total de itens"
          value={totalItens}
          icon={<Package className="size-4" />}
          color="blue"
        />
        <KpiCard
          label="Disponíveis"
          value={disponiveis}
          icon={<CheckCircle2 className="size-4" />}
          color="green"
        />
        <KpiCard
          label="Baixo estoque"
          value={baixoEstoque}
          icon={<TrendingDown className="size-4" />}
          color="amber"
        />
        <KpiCard
          label="Esgotados"
          value={esgotados}
          icon={<AlertTriangle className="size-4" />}
          color="red"
        />
      </div>

      {/* Tabela por categoria */}
      {Object.entries(grouped).map(([cat, itens]) => (
        <div key={cat} className="rounded-2xl bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold">
              {CATEGORIA_LABEL[cat] ?? cat}
            </h3>
          </div>
          <div className="divide-y divide-border">
            {itens.map((m) => {
              const pct = m.quantidade_total > 0
                ? Math.round((m.quantidade_disponivel / m.quantidade_total) * 100)
                : 0;
              const status =
                m.quantidade_disponivel === 0
                  ? "esgotado"
                  : pct <= 20
                  ? "baixo"
                  : "ok";

              return (
                <div key={m.id} className="px-4 py-3 flex items-center gap-3">
                  {/* Status dot */}
                  <div
                    className={`size-2 rounded-full shrink-0 ${
                      status === "esgotado"
                        ? "bg-destructive"
                        : status === "baixo"
                        ? "bg-amber-500"
                        : "bg-emerald-500"
                    }`}
                  />

                  {/* Nome */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{m.nome}</p>
                    <div className="flex items-center gap-3 mt-0.5">
                      {/* Barra de progresso */}
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden max-w-[80px]">
                        <div
                          className={`h-full rounded-full ${
                            status === "esgotado"
                              ? "bg-destructive"
                              : status === "baixo"
                              ? "bg-amber-500"
                              : "bg-emerald-500"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-muted-foreground">{pct}%</span>
                    </div>
                  </div>

                  {/* Números */}
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold">
                      <span
                        className={
                          status === "esgotado"
                            ? "text-destructive"
                            : status === "baixo"
                            ? "text-amber-600"
                            : "text-emerald-600"
                        }
                      >
                        {m.quantidade_disponivel}
                      </span>
                      <span className="text-muted-foreground font-normal text-xs"> / {m.quantidade_total}</span>
                    </p>
                    {m.quantidade_armada > 0 && (
                      <p className="text-[10px] text-muted-foreground">{m.quantidade_armada} em uso</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {items.length === 0 && (
        <div className="rounded-2xl bg-card p-10 text-center text-muted-foreground text-sm"
          style={{ boxShadow: "var(--shadow-card)" }}>
          Nenhum material cadastrado no almoxarifado.
        </div>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: "blue" | "green" | "amber" | "red";
}) {
  const colorMap = {
    blue:  { bg: "bg-primary/10",   text: "text-primary",     num: "text-primary" },
    green: { bg: "bg-emerald-100",  text: "text-emerald-700", num: "text-emerald-700" },
    amber: { bg: "bg-amber-100",    text: "text-amber-700",   num: "text-amber-700" },
    red:   { bg: "bg-destructive/10", text: "text-destructive", num: "text-destructive" },
  };
  const c = colorMap[color];
  return (
    <div className="rounded-2xl bg-card p-4 space-y-2" style={{ boxShadow: "var(--shadow-card)" }}>
      <div className={`size-8 rounded-xl ${c.bg} ${c.text} flex items-center justify-center`}>
        {icon}
      </div>
      <p className={`text-2xl font-bold ${c.num}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
