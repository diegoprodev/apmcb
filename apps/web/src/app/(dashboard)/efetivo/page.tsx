
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
  try {
    const res = await fetch(`${BFF_URL}/api/cautelamentos/ativos`, {
      headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      cache: "no-store",
    });
    if (res.ok) {
      const json = await res.json();
      cautelasCount = (json.cautelamentos ?? []).length;
    }
  } catch {}

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
  const { data: requests } = await supabase
    .from("material_requests")
    .select(`
      id, status, requested_at, approved_at, expires_at, denial_reason, armeiro_nota,
      items:material_request_items(
        material_nome_snapshot, requested_quantity
      )
    `)
    .eq("military_id", user.id)
    .order("requested_at", { ascending: false })
    .limit(5);

  const recentRequests = requests ?? [];
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

      <div>
        <h2 className="text-2xl font-bold tracking-tight">
          Olá, {profile.posto ? `${profile.posto} ` : ""}{profile.nome_de_guerra ?? profile.nome_completo?.split(" ")[0] ?? "Usuário"}
        </h2>
        <p className="text-muted-foreground text-sm mt-1">
          Acompanhe seus materiais emprestados
        </p>
      </div>

      {/* Summary strip — 4 clickable cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MiniStatLink
          href="/efetivo/minhas-cautelas"
          icon={<Package className="size-4" />}
          label="Em uso"
          tooltip="Ver materiais ativos"
          value={String(activeLendings.length)}
        />
        <MiniStatLink
          href="/efetivo/historico"
          icon={<Clock className="size-4" />}
          label="Histórico"
          tooltip="Ver histórico completo"
          value={String(totalCount ?? 0)}
        />
        <MiniStatLink
          href="/efetivo/historico?status=devolvido"
          icon={<CheckCircle2 className="size-4" />}
          label="Devolvidos"
          tooltip="Ver materiais devolvidos"
          value={String(returnedCount)}
        />
        <MiniStatLink
          href="/efetivo/minhas-cautelas"
          icon={<ClipboardList className="size-4" />}
          label="Cautelas"
          tooltip="Ver minhas cautelas"
          value={String(cautelasCount)}
        />
      </div>

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

      {/* Solicitar Armamento — CTA + histórico de solicitações */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Solicitar Armamento</h3>
          {recentRequests.length > 2 && (
            <a href="/efetivo/solicitacoes" className="text-xs text-primary hover:underline">
              Ver todas
            </a>
          )}
        </div>

        <SolicitarArmamentoSheet activeRequest={activeRequest ? { status: activeRequest.status } : null}>
          <Button
            size="sm"
            className="cursor-pointer"
            data-testid="btn-solicitar-armamento"
          >
            <Shield className="size-4 mr-1.5" />
            {activeRequest ? "Solicitação Remota" : "Requisitar Armamento"}
          </Button>
        </SolicitarArmamentoSheet>

        {recentRequests.length > 0 && (
          <div className="space-y-3 mt-1">
            {recentRequests.slice(0, 3).map((r) => {
              const s = r.status as "pendente" | "aprovado" | "rejeitado" | "retirado" | "expirado" | "cancelado";
              const it = r.items as { material_nome_snapshot: string; requested_quantity: number }[];
              return (
                <SolicitacaoDetailSheet
                  key={r.id}
                  id={r.id}
                  status={s}
                  items={it}
                  requested_at={r.requested_at}
                  approved_at={r.approved_at}
                  expires_at={r.expires_at}
                  denial_reason={r.denial_reason}
                  armeiro_nota={(r as any).armeiro_nota ?? null}
                >
                  <SolicitacaoStatusCard
                    id={r.id}
                    status={s}
                    items={it}
                    requested_at={r.requested_at}
                    approved_at={r.approved_at}
                    expires_at={r.expires_at}
                    denial_reason={r.denial_reason}
                    armeiro_nota={(r as any).armeiro_nota ?? null}
                  />
                </SolicitacaoDetailSheet>
              );
            })}
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
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  tooltip: string;
  value: string;
}) {
  return (
    <Link
      href={href}
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
