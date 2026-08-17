
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { Package, Clock, CheckCircle2, Shield, Fingerprint, KeyRound, AlertTriangle, ClipboardList } from "lucide-react";
import { TOTPSetupCard } from "@/components/ssa/totp-setup-card";
import { SolicitarArmamentoSheet } from "@/components/ssa/solicitar-armamento-sheet";
import { SolicitacaoStatusCard } from "@/components/ssa/solicitacao-status-card";
import { SolicitacaoDetailSheet } from "@/components/ssa/solicitacao-detail-sheet";
import { Button } from "@/components/ui/button";
import { fetchMilitaryRequests } from "@/lib/ssa/fetch-military-requests";
import { MateriaisUsoClient } from "./_materiais-uso-client";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

export default async function EfetivoPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, nome_completo, posto, nome_de_guerra, registration_status, totp_configured")
    .eq("id", user.id)
    .single();

  const cookieStore = await cookies();
  const activeMode = cookieStore.get("apmcb_mode")?.value;
  if (!profile || (profile.role !== "usuario" && activeMode !== "usuario")) redirect("/");

  const { data: { session } } = await supabase.auth.getSession();

  // Cautelas count
  let cautelasCount = 0;
  let cautelasError = false;
  try {
    const res = await fetch(`${BFF_URL}/api/cautelamentos/ativos`, {
      headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      cache: "no-store",
    });
    if (res.ok) {
      const json = await res.json();
      cautelasCount = (json.cautelamentos ?? []).length;
    } else {
      cautelasError = true;
    }
  } catch (err) {
    console.error("[efetivo] falha ao buscar cautelas ativas", err);
    cautelasError = true;
  }

  // Lendings
  const { data: lendings } = await supabase
    .from("lendings")
    .select(`
      id, status_legacy, issued_at, quantidade, local, movement_id,
      material_types(nome, categoria),
      reserve:reserves(nome),
      master:profiles!lendings_master_id_fkey(nome_completo, posto)
    `)
    .eq("military_id", user.id)
    .order("issued_at", { ascending: false })
    .limit(50);

  const allLendings = lendings ?? [];
  const activeLendings = allLendings.filter((l) => l.status_legacy === "ativo");
  const returnedCount = allLendings.filter((l) => l.status_legacy === "devolvido").length;

  const { count: totalCount } = await supabase
    .from("lendings")
    .select("id", { count: "exact", head: true })
    .eq("military_id", user.id);

  const totpConfigured = profile?.totp_configured ?? false;

  // Recent material requests
  const { requests: recentRequests, error: requestsError } = await fetchMilitaryRequests(supabase, user.id, 5);
  const activeRequest = recentRequests.find((r) =>
    ["pendente", "aprovado"].includes(r.status)
  );

  const biometricPending = profile.registration_status === "pending_biometric";
  const hasPendingSetup = biometricPending || !totpConfigured;

  return (
    <div className="space-y-6">
      {/* Pendências — card único e compacto */}
      {hasPendingSetup && (
        <div className="rounded-2xl border border-amber-200/70 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-800/40 px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="size-3.5 text-amber-600 shrink-0" />
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wide">
              Configurações pendentes
            </p>
          </div>
          <ul className="space-y-1">
            {biometricPending && (
              <li className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                <Fingerprint className="size-3 shrink-0" />
                Biometria — compareça ao Reserva de Armamento para registrar
              </li>
            )}
            {!totpConfigured && (
              <li className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                <KeyRound className="size-3 shrink-0" />
                Código de acesso (TOTP) — configure abaixo para requisitar armamento
              </li>
            )}
          </ul>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Olá, {profile.posto ? `${profile.posto} ` : ""}{profile.nome_de_guerra ?? profile.nome_completo?.split(" ")[0] ?? "Usuário"}
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            Acompanhe seus materiais emprestados
          </p>
        </div>

        {/* Requisitar Armamento — ação principal, acessível sem scroll (CLAUDE.md:
            "mínimo de fricção, ação principal em ≤ 2 cliques"). Antes ficava
            no fim da página, abaixo de Materiais em uso. */}
        {requestsError ? (
          // Achado de code review: `activeRequest` vem de `recentRequests`,
          // que fica `[]` quando a query falha — sem esta checagem, uma
          // falha transitória faria o CTA "falhar aberto" e oferecer
          // "Requisitar Armamento" mesmo com uma solicitação pendente/aprovada
          // real (o BFF ainda bloqueia a duplicata no servidor, mas a UI
          // ficaria enganosa). Desabilita em vez de arriscar o rótulo errado.
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

      {/* Summary strip — 4 clickable cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MiniStatLink
          href="/efetivo/historico?status=ativo"
          icon={<Package className="size-4" />}
          label="Em uso"
          tooltip="Ver materiais ativos"
          value={String(activeLendings.length)}
          testId="dashboard-stat-em-uso"
        />
        <MiniStatLink
          href="/efetivo/historico"
          icon={<Clock className="size-4" />}
          label="Histórico"
          tooltip="Ver histórico completo"
          value={String(totalCount ?? 0)}
          testId="dashboard-stat-historico"
        />
        <MiniStatLink
          href="/efetivo/historico?status=devolvido"
          icon={<CheckCircle2 className="size-4" />}
          label="Devolvidos"
          tooltip="Ver materiais devolvidos"
          value={String(returnedCount)}
          testId="dashboard-stat-devolvidos"
        />
        <MiniStatLink
          href="/efetivo/minhas-cautelas"
          icon={<ClipboardList className="size-4" />}
          label="Cautelas"
          tooltip="Ver minhas cautelas"
          value={cautelasError ? "—" : String(cautelasCount)}
          testId="dashboard-stat-cautelas"
        />
      </div>

      {cautelasError && (
        <div
          data-testid="cautelas-error-notice"
          className="rounded-xl border border-dashed border-destructive/40 bg-card p-2.5 text-xs text-destructive flex items-center gap-2"
        >
          <AlertTriangle className="size-3.5 shrink-0" />
          Não foi possível carregar suas cautelas ativas agora.
        </div>
      )}

      {/* TOTP setup card */}
      <TOTPSetupCard configured={totpConfigured} />

      {/* Active lendings — grouped by movement with checkboxes */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Materiais em uso</h3>
        <MateriaisUsoClient
          activeLendings={activeLendings.map((l) => {
            const mt = Array.isArray(l.material_types) ? l.material_types[0] : l.material_types;
            const rsv = Array.isArray((l as any).reserve) ? (l as any).reserve[0] : (l as any).reserve;
            const mst = Array.isArray((l as any).master) ? (l as any).master[0] : (l as any).master;
            return {
              id: l.id,
              issued_at: l.issued_at,
              quantidade: l.quantidade ?? 1,
              local: l.local ?? null,
              movement_id: (l as any).movement_id ?? null,
              material_nome: mt?.nome ?? "—",
              material_categoria: mt?.categoria ?? "—",
              reserve_nome: rsv?.nome ?? null,
              master_nome: mst
                ? [mst.posto, mst.nome_completo?.split(" ")[0]].filter(Boolean).join(" ") || null
                : null,
            };
          })}
        />
      </div>

      {/* Últimas solicitações — preview + link para o histórico completo.
          O CTA "Requisitar Armamento" foi movido para o topo da página; esta
          seção mantém apenas o preview das últimas solicitações. */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Últimas solicitações</h3>
          {recentRequests.length > 2 && (
            <a href="/efetivo/solicitacoes" className="text-xs text-primary hover:underline">
              Ver todas
            </a>
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
        ) : recentRequests.length > 0 && (
          <div className="space-y-3 mt-1">
            {recentRequests.slice(0, 3).map((r) => (
              <SolicitacaoDetailSheet
                key={r.id}
                id={r.id}
                status={r.status}
                items={r.items}
                requested_at={r.requested_at}
                approved_at={r.approved_at}
                expires_at={r.expires_at}
                denial_reason={r.denial_reason}
                cancellation_reason={r.cancellation_reason}
                armeiro_nota={r.armeiro_nota}
              >
                <SolicitacaoStatusCard
                  id={r.id}
                  status={r.status}
                  items={r.items}
                  requested_at={r.requested_at}
                  approved_at={r.approved_at}
                  expires_at={r.expires_at}
                  denial_reason={r.denial_reason}
                  cancellation_reason={r.cancellation_reason}
                  armeiro_nota={r.armeiro_nota}
                />
              </SolicitacaoDetailSheet>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MiniStatLink({
  href,
  icon,
  label,
  tooltip,
  value,
  testId,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  tooltip: string;
  value: string;
  testId: string;
}) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className="group relative block rounded-xl bg-card p-3 text-center hover:bg-primary/5 transition-colors"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      {/* CSS tooltip — theme primary color */}
      <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 z-10 whitespace-nowrap rounded-lg bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        {tooltip}
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-[5px] border-transparent border-t-primary" />
      </span>
      <div className="text-primary flex justify-center mb-1">{icon}</div>
      <p className="text-lg font-bold">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </Link>
  );
}
