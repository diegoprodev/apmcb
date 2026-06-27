
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AprovacaoClient } from "./_aprovacao-client";

export default async function SolicitacoesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin_reserva") redirect("/");

  const { data: { session } } = await supabase.auth.getSession();
  const bffUrl = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";
  const res = await fetch(`${bffUrl}/api/arsenal/requests?status=all`, {
    headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
    cache: "no-store",
  });
  const requests = res.ok ? await res.json() : [];

  // Supabase returns joined tables as arrays; flatten to single objects
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const normalized = (requests ?? []).map((r: any) => ({
    ...r,
    requestor: Array.isArray(r.requestor) ? r.requestor[0] ?? null : r.requestor,
    material: Array.isArray(r.material) ? r.material[0] ?? null : r.material,
    reviewer: Array.isArray(r.reviewer) ? r.reviewer[0] ?? null : r.reviewer,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Solicitações de Armeiro</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Aprovação de ajustes, adições e desativações solicitadas por armeiros
        </p>
      </div>

      <AprovacaoClient requests={normalized} />
    </div>
  );
}
