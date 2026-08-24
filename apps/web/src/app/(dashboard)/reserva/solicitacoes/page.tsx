
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, getSessionProfile } from "@/lib/session-profile";
import { redirect } from "next/navigation";
import { SolicitacoesClient } from "./_solicitacoes-client";
import { RealtimeArmeiroSync } from "@/components/reserva/realtime-armeiro-sync";

export default async function SolicitacoesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = await searchParams;
  const limit = Math.min(Math.max(parseInt(params?.limit ?? "20") || 20, 10), 50);
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const profile = await getSessionProfile(user.id);

  if (profile?.role !== "armeiro" && profile?.role !== "admin_global" && profile?.role !== "admin_reserva" && profile?.role !== "superadmin") redirect("/");

  // BUG-RR-07: filtro explícito por tenant (RLS também garante, mas defense-in-depth)
  let query = supabase
    .from("material_requests")
    .select(`
      id, status, notes, denial_reason, armeiro_nota,
      remote_reason, is_external_request, reserve_id, tenant_id,
      cancellation_reason, totp_validated, requested_at, approved_at,
      rejected_at, delivered_at, cancelled_at, expires_at,
      military:profiles!material_requests_military_id_fkey(
        id, nome_completo, posto, matricula
      ),
      reserva:profiles!material_requests_reserva_id_fkey(
        id, nome_completo
      ),
      items:material_request_items(
        id, material_type_id,
        material_nome_snapshot, material_categoria_snapshot,
        requested_quantity, delivered_quantity
      )
    `)
    .order("requested_at", { ascending: false })
    .limit(limit + 1);

  if (profile.default_tenant_id) {
    query = query.eq("tenant_id", profile.default_tenant_id);
  }

  // Achado real (2026-08-19): esta query nunca checava `error` — um
  // timeout (ou qualquer outra falha) virava silenciosamente "nenhuma
  // solicitação" na tela, indistinguível de "realmente não há nada
  // pendente". Causa raiz encontrada e corrigida nesta mesma entrega (RLS
  // obsoleta em material_request_items, ver migration
  // 20260819010000_fix_ssa_items_staff_rls_obsolete_roles.sql), mas o erro
  // agora fica visível caso qualquer falha futura (timeout, conexão) volte
  // a acontecer — evita o mesmo diagnóstico às cegas.
  const { data: rawRequests, error: requestsError } = await query;
  if (requestsError) {
    console.error("[solicitacoes] falha ao carregar solicitações", requestsError);
  }
  const hasMore = (rawRequests ?? []).length > limit;
  let requests = hasMore ? (rawRequests ?? []).slice(0, limit) : (rawRequests ?? []);

  // Deep-link do sino de notificações (?highlight=<id>): a solicitação alvo
  // pode estar fora da primeira página (ex: várias novas solicitações
  // chegaram entre a notificação ser criada e o clique) — sem isto, o card
  // simplesmente não apareceria e o realce/scroll do client não teria o que
  // destacar. Busca pontual (1 linha, mesmo SELECT) só quando necessário.
  // Valida formato UUID antes de usar em query — achado de code review:
  // um valor arbitrário no query param (nunca gerado pelo próprio app, mas
  // a URL é editável pelo usuário) disparava uma query inútil contra o
  // banco sem nenhum ganho (Supabase só retornaria vazio de qualquer
  // forma), mas sem essa validação não há sinal claro de "isso não é um id
  // válido" no caminho.
  const highlightId = /^[0-9a-f-]{36}$/i.test(params?.highlight ?? "") ? params.highlight : undefined;
  if (highlightId && !requests.some((r) => r.id === highlightId)) {
    let highlightQuery = supabase
      .from("material_requests")
      .select(`
        id, status, notes, denial_reason, armeiro_nota,
        remote_reason, is_external_request, reserve_id, tenant_id,
        cancellation_reason, totp_validated, requested_at, approved_at,
        rejected_at, delivered_at, cancelled_at, expires_at,
        military:profiles!material_requests_military_id_fkey(
          id, nome_completo, posto, matricula
        ),
        reserva:profiles!material_requests_reserva_id_fkey(
          id, nome_completo
        ),
        items:material_request_items(
          id, material_type_id,
          material_nome_snapshot, material_categoria_snapshot,
          requested_quantity, delivered_quantity
        )
      `)
      .eq("id", highlightId);
    // Mesmo escopo de tenant da query principal (linha ~49) — sem isto, um
    // armeiro poderia forjar ?highlight=<id de outro tenant> e, mesmo que a
    // RLS bloqueie a leitura de qualquer forma, fica sem defense-in-depth.
    if (profile.default_tenant_id) {
      highlightQuery = highlightQuery.eq("tenant_id", profile.default_tenant_id);
    }
    const { data: highlighted } = await highlightQuery.maybeSingle();
    if (highlighted) requests = [highlighted, ...requests];
  }

  return (
    <div className="space-y-6">
      {profile?.default_tenant_id && <RealtimeArmeiroSync tenantId={profile.default_tenant_id} />}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Pendências Remotas</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Solicitações de armamento — aprove, rejeite ou confirme a entrega
        </p>
      </div>
      {requestsError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Não foi possível carregar as solicitações agora (falha de conexão com o banco). Atualize a página em alguns instantes — se persistir, avise o suporte.
        </div>
      )}
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <SolicitacoesClient initialRequests={requests as any} hasMore={hasMore} currentLimit={limit} />
    </div>
  );
}
