
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { SolicitacoesEfetivoClient } from "./_solicitacoes-efetivo-client";

export default async function SolicitacoesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = await searchParams;
  const limit = Math.min(Math.max(parseInt(params?.limit ?? "20") || 20, 10), 50);

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

  const { data: rawRequests } = await supabase
    .from("material_requests")
    .select(`
      id, status, requested_at, approved_at, expires_at,
      denial_reason, cancellation_reason, armeiro_nota,
      items:material_request_items(
        material_nome_snapshot, requested_quantity
      )
    `)
    .eq("military_id", user.id)
    .order("requested_at", { ascending: false })
    .limit(limit + 1);

  const hasMore = (rawRequests ?? []).length > limit;
  const requests = hasMore ? (rawRequests ?? []).slice(0, limit) : (rawRequests ?? []);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/efetivo" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold tracking-tight">Solicitações Remotas</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Histórico e acompanhamento das suas solicitações</p>
        </div>
      </div>

      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <SolicitacoesEfetivoClient requests={requests as any} hasMore={hasMore} currentLimit={limit} />
    </div>
  );
}
