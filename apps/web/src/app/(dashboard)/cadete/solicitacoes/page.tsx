
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { SolicitacaoStatusCard } from "@/components/ssa/solicitacao-status-card";

export default async function SolicitacoesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const cookieStore = await cookies();
  const activeMode = cookieStore.get("apmcb_mode")?.value;
  if (!profile || (profile.role !== "usuario" && activeMode !== "usuario")) redirect("/");

  const { data: requests } = await supabase
    .from("material_requests")
    .select(`
      id, status, requested_at, approved_at, expires_at, denial_reason,
      items:material_request_items(
        material_nome_snapshot, requested_quantity
      )
    `)
    .eq("military_id", user.id)
    .order("requested_at", { ascending: false });

  const allRequests = requests ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/cadete" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-xl font-bold tracking-tight">Todas as Solicitações</h1>
      </div>

      {allRequests.length === 0 ? (
        <div className="rounded-2xl border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          Nenhuma solicitação de armamento registrada.
        </div>
      ) : (
        <div className="space-y-3">
          {allRequests.map((r) => (
            <SolicitacaoStatusCard
              key={r.id}
              id={r.id}
              status={r.status as "pendente" | "aprovado" | "rejeitado" | "retirado" | "expirado" | "cancelado"}
              items={r.items as { material_nome_snapshot: string; requested_quantity: number }[]}
              requested_at={r.requested_at}
              approved_at={r.approved_at}
              expires_at={r.expires_at}
              denial_reason={r.denial_reason}
            />
          ))}
        </div>
      )}
    </div>
  );
}
