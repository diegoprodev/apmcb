
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { OcorrenciaActions } from "./_actions";

export default async function OcorrenciasPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "armeiro" && profile?.role !== "admin_global" && profile?.role !== "admin_reserva" && profile?.role !== "superadmin") redirect("/");

  const { data: ocorrencias } = await supabase
    .from("ocorrencias")
    .select(`
      id, titulo, descricao, status, material_nome_snapshot, created_at,
      military:profiles!ocorrencias_military_id_fkey(nome_completo, posto, matricula)
    `)
    .in("status", ["aberta", "em_analise"])
    .order("created_at", { ascending: false })
    .limit(100);

  const STATUS_LABEL: Record<string, string> = {
    aberta: "Aberta",
    em_analise: "Em análise",
    resolvida: "Resolvida",
    improcedente: "Improcedente",
  };

  const STATUS_COLOR: Record<string, string> = {
    aberta: "text-amber-700 bg-amber-50 border-amber-200",
    em_analise: "text-blue-700 bg-blue-50 border-blue-200",
    resolvida: "text-emerald-700 bg-emerald-50 border-emerald-200",
    improcedente: "text-gray-600 bg-gray-50 border-gray-200",
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Ocorrências</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Problemas reportados com materiais pelos militares
        </p>
      </div>

      {!ocorrencias || ocorrencias.length === 0 ? (
        <div
          className="rounded-2xl bg-card p-12 text-center"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <CheckCircle2 className="size-10 text-emerald-500/60 mx-auto mb-3" />
          <p className="text-sm font-medium">Nenhuma ocorrência aberta</p>
          <p className="text-xs text-muted-foreground mt-1">Tudo em ordem por aqui.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(ocorrencias as any[]).map((occ) => {
            const military = Array.isArray(occ.military) ? occ.military[0] : occ.military;
            return (
              <div
                key={occ.id}
                className="rounded-2xl bg-card p-5 space-y-3"
                style={{ boxShadow: "var(--shadow-card)" }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1 text-xs font-semibold rounded-full border px-2.5 py-0.5 ${STATUS_COLOR[occ.status]}`}>
                        {occ.status === "aberta" && <AlertTriangle className="size-3" />}
                        {occ.status === "em_analise" && <Clock className="size-3" />}
                        {STATUS_LABEL[occ.status] ?? occ.status}
                      </span>
                      {occ.material_nome_snapshot && (
                        <span className="text-xs text-muted-foreground">
                          {occ.material_nome_snapshot}
                        </span>
                      )}
                    </div>
                    <p className="font-semibold text-sm mt-1.5">{occ.titulo}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{occ.descricao}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-medium text-foreground">
                      {military?.posto} {military?.nome_completo ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono">{military?.matricula ?? "—"}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(occ.created_at).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                </div>

                <OcorrenciaActions id={occ.id} status={occ.status} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
