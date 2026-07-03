import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { OcorrenciasClient } from "./_ocorrencias-client";

export default async function OcorrenciasPage({
  searchParams,
}: {
  searchParams?: Promise<{ limit?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "armeiro" && profile?.role !== "admin_global" && profile?.role !== "admin_reserva" && profile?.role !== "superadmin") redirect("/");

  const params = await searchParams;
  const limit = Math.min(Math.max(parseInt(params?.limit ?? "10") || 10, 10), 30);

  const { data: raw } = await supabase
    .from("ocorrencias")
    .select(`
      id, titulo, descricao, status, material_nome_snapshot, created_at,
      military:profiles!ocorrencias_military_id_fkey(nome_completo, posto, matricula)
    `)
    .in("status", ["aberta", "em_analise"])
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  const all = (raw ?? []) as any[];
  const hasMore = all.length > limit;
  const ocorrencias = hasMore ? all.slice(0, limit) : all;

  const resolved = ocorrencias.map((o: any) => ({
    ...o,
    military: Array.isArray(o.military) ? o.military[0] ?? null : o.military ?? null,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Ocorrências</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Problemas reportados com materiais pelos militares
        </p>
      </div>

      <OcorrenciasClient
        ocorrencias={resolved}
        hasMore={hasMore}
        currentLimit={limit}
      />
    </div>
  );
}
