export const runtime = 'edge';

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Package, Plus } from "lucide-react";
import Link from "next/link";
import { StatusFilter } from "./_status-filter";
import { SaidasTable } from "./_saidas-table";

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
      id, quantidade, status, issued_at, returned_at, local, notes, auth_mode, material_request_id,
      material_type:material_types(nome, categoria),
      military:profiles!lendings_military_id_fkey(nome_completo, matricula, posto),
      master:profiles!lendings_master_id_fkey(nome_completo, matricula)
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
            Controle de saídas e devoluções do almoxarifado
          </p>
        </div>
        <Link
          href="/reserva/saidas/nova"
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
          <SaidasTable saidas={saidas as any[]} />
        )}
      </div>
    </div>
  );
}
