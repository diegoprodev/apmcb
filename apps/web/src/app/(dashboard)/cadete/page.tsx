export const runtime = 'edge';

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Package, Clock, CheckCircle2 } from "lucide-react";

export default async function CadetePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, nome_completo, registration_status")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "military") redirect("/");
  if (profile.registration_status !== "complete") redirect("/registro-pendente");

  const { data: lendings } = await supabase
    .from("lendings")
    .select("id, status, issued_at, quantidade, material_types(nome, categoria)")
    .eq("military_id", user.id)
    .order("issued_at", { ascending: false })
    .limit(10);

  const allLendings = lendings ?? [];
  const activeLendings = allLendings.filter((l) => l.status === "ativo");
  const returnedCount = allLendings.filter((l) => l.status === "devolvido").length;

  const { count: totalCount } = await supabase
    .from("lendings")
    .select("id", { count: "exact", head: true })
    .eq("military_id", user.id);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">
          Olá, {profile.nome_completo?.split(" ")[0] ?? "Cadete"}
        </h2>
        <p className="text-muted-foreground text-sm mt-1">
          Acompanhe seus materiais emprestados
        </p>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-3">
        <MiniStat
          icon={<Package className="size-4" />}
          label="Em uso"
          value={String(activeLendings.length)}
        />
        <MiniStat
          icon={<Clock className="size-4" />}
          label="Histórico"
          value={String(totalCount ?? 0)}
        />
        <MiniStat
          icon={<CheckCircle2 className="size-4" />}
          label="Devolvidos"
          value={String(returnedCount)}
        />
      </div>

      {/* Active lendings list or empty state */}
      {activeLendings.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Materiais em uso</h3>
          {activeLendings.map((lending) => {
            const material = Array.isArray(lending.material_types)
              ? lending.material_types[0]
              : lending.material_types;
            return (
              <div
                key={lending.id}
                className="rounded-2xl bg-card p-4 flex items-center justify-between"
                style={{ boxShadow: "var(--shadow-card)" }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <Package className="size-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {material?.nome ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {material?.categoria ?? "—"} · Qtd: {lending.quantidade ?? 1}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Saída: {new Date(lending.issued_at).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                </div>
                <span className="badge-in-use text-[10px] font-semibold tracking-wide rounded-full px-2.5 py-0.5">
                  Ativo
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div
          className="rounded-2xl bg-card p-10 text-center"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <Package className="size-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">Nenhum material em uso</p>
          <p className="text-xs text-muted-foreground mt-1">
            Procure o armeiro para retirar materiais
          </p>
        </div>
      )}
    </div>
  );
}

function MiniStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div
      className="rounded-xl bg-card p-3 text-center"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="text-primary flex justify-center mb-1">{icon}</div>
      <p className="text-lg font-bold">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}
