export const runtime = 'edge';

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Package, Plus } from "lucide-react";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReturnButton } from "./_return-button";
import { StatusFilter } from "./_status-filter";

export default async function SaidasPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "master" && profile?.role !== "admin") redirect("/");

  let query = supabase
    .from("lendings")
    .select(`
      id, quantidade, status, issued_at, returned_at,
      material_type:material_types(nome, categoria),
      military:profiles!lendings_military_id_fkey(nome_completo, matricula, posto)
    `)
    .order("issued_at", { ascending: false })
    .limit(50);

  if (status === "ativo" || status === "devolvido") {
    query = query.eq("status", status);
  }

  const { data: saidas } = await query;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Saídas de Material</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Controle de saídas e devoluções do arsenal
          </p>
        </div>
        <Link
          href="/armeiro/saidas/nova"
          className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Plus className="size-4" />
          Nova Saída
        </Link>
      </div>

      <StatusFilter current={status ?? ""} />

      <div
        className="rounded-2xl bg-card overflow-hidden"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        {!saidas || saidas.length === 0 ? (
          <div className="p-10 text-center">
            <Package className="size-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm font-medium">Nenhuma saída registrada</p>
            <p className="text-xs text-muted-foreground mt-1">
              Registre a primeira saída de material
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border hover:bg-transparent">
                <TableHead className="pl-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Material
                </TableHead>
                <TableHead className="py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden sm:table-cell">
                  Militar
                </TableHead>
                <TableHead className="py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-center">
                  Qtd
                </TableHead>
                <TableHead className="py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">
                  Data Saída
                </TableHead>
                <TableHead className="py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">
                  Devolução
                </TableHead>
                <TableHead className="py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Status
                </TableHead>
                <TableHead className="pr-5 py-3 w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {saidas.map((s: any) => (
                <TableRow
                  key={s.id}
                  className="border-b border-border/60 hover:bg-muted/40 transition-colors"
                >
                  <TableCell className="pl-5 py-3">
                    <p className="font-medium text-sm">{s.material_type?.nome ?? "—"}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {s.material_type?.categoria ?? "—"}
                    </p>
                  </TableCell>
                  <TableCell className="py-3 hidden sm:table-cell">
                    <p className="text-sm font-medium">{s.military?.nome_completo ?? "—"}</p>
                    <p className="font-mono text-xs text-muted-foreground">{s.military?.matricula ?? "—"}</p>
                  </TableCell>
                  <TableCell className="py-3 text-center text-sm">{s.quantidade}</TableCell>
                  <TableCell className="py-3 hidden md:table-cell text-xs text-muted-foreground">
                    {s.issued_at ? new Date(s.issued_at).toLocaleDateString("pt-BR") : "—"}
                  </TableCell>
                  <TableCell className="py-3 hidden md:table-cell text-xs text-muted-foreground">
                    {s.returned_at ? new Date(s.returned_at).toLocaleDateString("pt-BR") : "—"}
                  </TableCell>
                  <TableCell className="py-3">
                    <span
                      className={
                        s.status === "ativo"
                          ? "badge-in-use text-xs px-2 py-0.5 rounded-full font-medium"
                          : "badge-success text-xs px-2 py-0.5 rounded-full font-medium"
                      }
                    >
                      {s.status === "ativo" ? "Ativo" : "Devolvido"}
                    </span>
                  </TableCell>
                  <TableCell className="pr-5 py-3">
                    {s.status === "ativo" && (
                      <ReturnButton
                        saidaId={s.id}
                        materialNome={s.material_type?.nome ?? "material"}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
