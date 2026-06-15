export const runtime = 'edge';

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Package } from "lucide-react";

export default async function CadeteHistoricoPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, registration_status")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "military") redirect("/");

  const { data: lendings } = await supabase
    .from("lendings")
    .select("id, status, issued_at, returned_at, quantidade, material_types(nome, categoria)")
    .eq("military_id", user.id)
    .order("issued_at", { ascending: false });

  const allLendings = lendings ?? [];

  function statusBadge(status: string) {
    switch (status) {
      case "ativo":
        return (
          <span className="badge-in-use text-[10px] font-semibold tracking-wide rounded-full px-2.5 py-0.5">
            Ativo
          </span>
        );
      case "devolvido":
        return (
          <span className="badge-success text-[10px] font-semibold tracking-wide rounded-full px-2.5 py-0.5">
            Devolvido
          </span>
        );
      case "perdido":
        return (
          <span className="badge-danger text-[10px] font-semibold tracking-wide rounded-full px-2.5 py-0.5">
            Perdido
          </span>
        );
      default:
        return (
          <span className="badge-neutral text-[10px] font-semibold tracking-wide rounded-full px-2.5 py-0.5">
            {status}
          </span>
        );
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Histórico de Saídas</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Todos os materiais retirados e devolvidos
        </p>
      </div>

      {allLendings.length === 0 ? (
        <div
          className="rounded-2xl bg-card p-10 text-center"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <Package className="size-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">Nenhuma saída registrada</p>
          <p className="text-xs text-muted-foreground mt-1">
            Seu histórico aparecerá aqui quando você retirar materiais
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
                    Material
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-label">
                    Categoria
                  </th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-label">
                    Qtd
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-label">
                    Saída
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-label">
                    Devolução
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-label">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {allLendings.map((lending, index) => {
                  const material = Array.isArray(lending.material_types)
                    ? lending.material_types[0]
                    : lending.material_types;
                  return (
                    <tr
                      key={lending.id}
                      className={index < allLendings.length - 1 ? "border-b border-border" : ""}
                    >
                      <td className="px-4 py-3 font-medium text-foreground">
                        {material?.nome ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {material?.categoria ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-center text-muted-foreground">
                        {lending.quantidade ?? 1}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {lending.issued_at
                          ? new Date(lending.issued_at).toLocaleDateString("pt-BR")
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {lending.returned_at
                          ? new Date(lending.returned_at).toLocaleDateString("pt-BR")
                          : "—"}
                      </td>
                      <td className="px-4 py-3">{statusBadge(lending.status)}</td>
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
