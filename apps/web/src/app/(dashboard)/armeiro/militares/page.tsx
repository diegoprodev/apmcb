export const runtime = 'edge';

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Users, User } from "lucide-react";

export default async function ArmeiroMilitaresPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "master" && profile?.role !== "admin") redirect("/");

  const { data: militares } = await supabase
    .from("profiles")
    .select("id, nome_completo, matricula, foto_url, registration_status, posto")
    .eq("role", "military")
    .order("nome_completo");

  const allMilitares = militares ?? [];

  // Fetch active lending counts per military
  const militaryIds = allMilitares.map((m) => m.id);
  const { data: activeLendings } = militaryIds.length > 0
    ? await supabase
        .from("lendings")
        .select("military_id")
        .in("military_id", militaryIds)
        .eq("status", "ativo")
    : { data: [] };

  const lendingCountMap: Record<string, number> = {};
  for (const lending of activeLendings ?? []) {
    lendingCountMap[lending.military_id] = (lendingCountMap[lending.military_id] ?? 0) + 1;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Militares</h2>
          <p className="text-muted-foreground text-sm mt-1">
            {allMilitares.length} militar{allMilitares.length !== 1 ? "es" : ""} cadastrado
            {allMilitares.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Users className="size-5" />
        </div>
      </div>

      {allMilitares.length === 0 ? (
        <div
          className="rounded-2xl bg-card p-10 text-center"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <Users className="size-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">Nenhum militar cadastrado</p>
          <p className="text-xs text-muted-foreground mt-1">
            Cadastre militares para gerenciar empréstimos
          </p>
        </div>
      ) : (
        <div
          className="rounded-2xl bg-card overflow-hidden"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-label">
                    Nome
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-label">
                    Matrícula
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-label">
                    Posto
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-label">
                    Biometria
                  </th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-label">
                    Em uso
                  </th>
                </tr>
              </thead>
              <tbody>
                {allMilitares.map((militar, index) => {
                  const initials = (militar.nome_completo ?? "")
                    .split(" ")
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((w: string) => w[0])
                    .join("")
                    .toUpperCase();

                  const biometricComplete =
                    militar.registration_status === "complete";
                  const activeCount = lendingCountMap[militar.id] ?? 0;

                  return (
                    <tr
                      key={militar.id}
                      className={index < allMilitares.length - 1 ? "border-b border-border" : ""}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {militar.foto_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={militar.foto_url}
                              alt={militar.nome_completo ?? "Foto"}
                              className="w-8 h-8 rounded-lg object-cover shrink-0"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                              {initials || <User className="size-4" />}
                            </div>
                          )}
                          <span className="font-medium text-foreground">
                            {militar.nome_completo ?? "—"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {militar.matricula ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {militar.posto ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        {biometricComplete ? (
                          <span className="badge-success text-[10px] font-semibold tracking-wide rounded-full px-2.5 py-0.5">
                            Completa
                          </span>
                        ) : (
                          <span className="badge-warning text-[10px] font-semibold tracking-wide rounded-full px-2.5 py-0.5">
                            Pendente
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {activeCount > 0 ? (
                          <span className="badge-in-use text-[10px] font-semibold tracking-wide rounded-full px-2.5 py-0.5">
                            {activeCount}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
