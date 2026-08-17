
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ArrowLeft, AlertTriangle, Shield } from "lucide-react";
import Link from "next/link";
import { SolicitarArmamentoSheet } from "@/components/ssa/solicitar-armamento-sheet";
import { Button } from "@/components/ui/button";
import { fetchMilitaryRequests } from "@/lib/ssa/fetch-military-requests";
import { SolicitacoesEfetivoClient } from "./_solicitacoes-efetivo-client";

export default async function SolicitacoesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = await searchParams;
  const limit = Math.min(Math.max(parseInt(params?.limit ?? "10") || 10, 10), 30);

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

  const { requests: rawRequests, error: requestsError } = await fetchMilitaryRequests(supabase, user.id, limit + 1);

  const hasMore = rawRequests.length > limit;
  const requests = hasMore ? rawRequests.slice(0, limit) : rawRequests;

  // Mirrors efetivo/page.tsx: a "pendente"/"aprovado" request blocks new ones
  // and swaps the CTA label to "Solicitação Remota". Business rule enforced
  // by the BFF means at most one active request can exist at a time, and —
  // being unresolved — it is always the most recent by requested_at, so it's
  // safe to derive this from the already-fetched (unsliced) rawRequests
  // instead of a second query.
  const activeRequest = rawRequests.find((r) =>
    ["pendente", "aprovado"].includes(r.status)
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/efetivo" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="size-5" />
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Solicitações Remotas</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Histórico e acompanhamento das suas solicitações</p>
          </div>
        </div>

        {/* Requisitar Armamento — antes só existia em /efetivo; achado real de
            produto: esta página lista as solicitações mas não oferecia como
            criar uma nova (CLAUDE.md: ação principal em ≤ 2 cliques). */}
        {requestsError ? (
          // Achado de code review: `activeRequest` deriva de `rawRequests`,
          // que fica `[]` quando a query falha — sem esta checagem, o CTA
          // "falharia aberto" e ofereceria "Requisitar Armamento" mesmo com
          // uma solicitação pendente/aprovada real ainda não confirmada.
          <Button
            className="w-full sm:w-auto shrink-0 opacity-60 cursor-not-allowed"
            data-testid="btn-solicitar-armamento"
            disabled
            title="Não foi possível confirmar suas solicitações atuais"
          >
            <Shield className="size-4 mr-1.5" />
            Requisitar Armamento
          </Button>
        ) : (
          <SolicitarArmamentoSheet activeRequest={activeRequest ? { status: activeRequest.status } : null}>
            <Button
              className="cursor-pointer w-full sm:w-auto shrink-0"
              data-testid="btn-solicitar-armamento"
            >
              <Shield className="size-4 mr-1.5" />
              {activeRequest ? "Solicitação Remota" : "Requisitar Armamento"}
            </Button>
          </SolicitarArmamentoSheet>
        )}
      </div>

      {requestsError ? (
        <div
          data-testid="requests-error-notice"
          className="rounded-xl border border-dashed border-destructive/40 bg-card p-4 text-center text-sm text-destructive flex items-center justify-center gap-2"
        >
          <AlertTriangle className="size-4 shrink-0" />
          {requestsError}
        </div>
      ) : (
        <SolicitacoesEfetivoClient requests={requests} hasMore={hasMore} currentLimit={limit} />
      )}
    </div>
  );
}
