
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Fingerprint, Package, UserCheck, Clock, TrendingUp, ClipboardList, Shield, UserX, AlertTriangle, PackageCheck, ArrowRightLeft, UserPlus } from "lucide-react";
import Link from "next/link";
import { VerifyTOTPDialog } from "@/components/reserva/_verify-totp-dialog";
import { ReserveRemoteAccessToggle } from "@/components/reserva/reserve-remote-access-toggle";
import { RealtimeArmeiroSync } from "@/components/reserva/realtime-armeiro-sync";

export default async function ArmeiroPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, default_tenant_id")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "armeiro" && profile?.role !== "admin_global" && profile?.role !== "admin_reserva" && profile?.role !== "superadmin") redirect("/");

  // Staff em modo usuário não deve ver o painel de armeiro
  const cookieStore = await cookies();
  if (cookieStore.get("apmcb_mode")?.value === "usuario") redirect("/efetivo");

  // Reserva do admin_reserva — para exibir toggle de acesso remoto
  // Visível para admin_reserva (própria reserva) e admin_global (qualquer reserva do tenant).
  // superadmin NÃO tem controle estrutural — apenas provisiona tenants.
  let currentReserve: { id: string; nome: string; allow_remote_requests: boolean } | null = null;
  if (profile?.role === "admin_reserva" || profile?.role === "admin_global") {
    const { data: rm } = await supabase
      .from("reserve_memberships")
      .select("reserve_id, reserves!inner(id, nome, allow_remote_requests)")
      .eq("user_id", user.id)
      .maybeSingle();
    const r = (rm as unknown as { reserves: { id: string; nome: string; allow_remote_requests: boolean } } | null)?.reserves;
    if (r) currentReserve = r;
  }

  // Pending counts
  const { count: activeCount } = await supabase
    .from("lendings")
    .select("id", { count: "exact", head: true })
    .eq("status_legacy", "ativo");

  const { count: pendingBiometricCount } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("registration_status", "pending_biometric");

  // SSA pending count — BUG-RR-08: filtrar por tenant
  const ssaPendingBase = supabase
    .from("material_requests")
    .select("id", { count: "exact", head: true })
    .in("status", ["pendente", "aprovado"]);
  const { count: ssaPendingCount } = profile?.default_tenant_id
    ? await ssaPendingBase.eq("tenant_id", profile.default_tenant_id)
    : await ssaPendingBase;

  // SSA approved awaiting pickup — BUG-RR-08: filtrar por tenant
  const retiradaBase = supabase
    .from("material_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "aprovado")
    .gt("expires_at", new Date().toISOString());
  const { count: retiradaCount } = profile?.default_tenant_id
    ? await retiradaBase.eq("tenant_id", profile.default_tenant_id)
    : await retiradaBase;

  // Usuários sem conta (sem login criado)
  const { count: semLoginCount } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "usuario")
    .is("account_activated_at", null);

  // Ocorrências abertas
  const { count: ocorrenciasCount } = await supabase
    .from("ocorrencias")
    .select("id", { count: "exact", head: true })
    .in("status", ["aberta", "em_analise"]);

  // Day summary
  const todayStr = new Date().toISOString().split("T")[0];

  const { count: todayLendingsCount } = await supabase
    .from("lendings")
    .select("id", { count: "exact", head: true })
    .gte("issued_at", todayStr);

  const { count: todayReturnsCount } = await supabase
    .from("lendings")
    .select("id", { count: "exact", head: true })
    .gte("returned_at", todayStr);

  return (
    <div className="space-y-6">
      {profile?.default_tenant_id && <RealtimeArmeiroSync tenantId={profile.default_tenant_id} />}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Reserva de Armamento</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Gestão de saídas de material e biometria
        </p>
      </div>

      {/* Modo A quick action */}
      <div className="flex justify-end">
        <VerifyTOTPDialog />
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ActionCard
          href="/reserva/militares"
          icon={<Fingerprint className="size-6" />}
          title="Identificar Usuário"
          description="Identificação biométrica 1:N via leitor ZKTeco"
          badge="Biometria"
        />
        <ActionCard
          href="/reserva/saidas/nova"
          icon={<Package className="size-6" />}
          title="Nova Saída"
          description="Registrar saída de material do almoxarifado"
          badge="Saída"
        />
        <ActionCard
          href="/reserva/militares"
          icon={<UserCheck className="size-6" />}
          title="Cadastrar Biometria"
          description="Captura biométrica e conclusão de cadastro"
          badge="Cadastro"
          count={pendingBiometricCount ?? 0}
          countVariant="warning"
        />
        <ActionCard
          href="/reserva/saidas?status=ativo"
          icon={<Clock className="size-6" />}
          title="Devoluções Pendentes"
          description="Materiais ainda com usuários"
          badge="Pendente"
          count={activeCount ?? 0}
          countVariant="danger"
        />
        <ActionCard
          href="/reserva/solicitacoes"
          icon={<ClipboardList className="size-6" />}
          title="Pendências Remotas"
          description="Solicitações de armamento aguardando resposta"
          badge="SSA"
          count={ssaPendingCount ?? 0}
          countVariant={ssaPendingCount && ssaPendingCount > 0 ? "warning" : undefined}
          data-testid="card-pendencias-remotas"
        />
        <ActionCard
          href="/reserva/solicitacoes?tab=aprovadas"
          icon={<PackageCheck className="size-6" />}
          title="Prontas para Retirada"
          description="Solicitações aprovadas aguardando retirada do usuário"
          badge="Retirada"
          count={retiradaCount ?? 0}
          countVariant={retiradaCount && retiradaCount > 0 ? "success" : undefined}
        />
        <ActionCard
          href="/reserva/arsenal"
          icon={<Shield className="size-6" />}
          title="Almoxarifado"
          description="Inventário completo de materiais e estoque"
          badge="Estoque"
        />
        <ActionCard
          href="/reserva/militares?filter=sem-login"
          icon={<UserX className="size-6" />}
          title="Sem Login"
          description="Usuários que ainda não criaram conta de acesso"
          badge="Acesso"
          count={semLoginCount ?? 0}
          countVariant={semLoginCount && semLoginCount > 0 ? "warning" : undefined}
        />
        <ActionCard
          href="/reserva/ocorrencias"
          icon={<AlertTriangle className="size-6" />}
          title="Ocorrências"
          description="Problemas reportados com materiais pelos usuários"
          badge="Ocorrências"
          count={ocorrenciasCount ?? 0}
          countVariant={ocorrenciasCount && ocorrenciasCount > 0 ? "danger" : undefined}
        />
        <ActionCard
          href="/reserva/passagens"
          icon={<ArrowRightLeft className="size-6" />}
          title="Passagem de Serviço"
          description="Livro digital de passagem de turno com assinatura dupla"
          badge="Passagem"
        />
        {(profile?.role === "admin_reserva" || profile?.role === "admin_global") && (
          <ActionCard
            href="/reserva/criar-armeiro"
            icon={<UserPlus className="size-6" />}
            title="Criar Armeiro"
            description="Provisionar acesso ao sistema para novo armeiro da reserva"
            badge="Acesso"
            data-testid="card-criar-armeiro"
          />
        )}
      </div>

      {/* Configurações da Reserva — apenas admin_reserva e superadmin */}
      {currentReserve && (
        <ReserveRemoteAccessToggle
          reserveId={currentReserve.id}
          reserveNome={currentReserve.nome}
          initialValue={currentReserve.allow_remote_requests}
        />
      )}

      {/* Resumo do Dia */}
      <div
        className="rounded-2xl bg-card p-5 space-y-4"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <div className="flex items-center gap-2">
          <TrendingUp className="size-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Resumo do Dia</h3>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-xl bg-primary/5 p-3 text-center">
            <p className="text-2xl font-bold text-primary">{todayLendingsCount ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Saídas hoje</p>
          </div>
          <div className="rounded-xl bg-[#D1FAE5]/60 p-3 text-center">
            <p className="text-2xl font-bold text-[#065F46]">{todayReturnsCount ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Devoluções hoje</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionCard({
  href,
  icon,
  title,
  description,
  badge,
  count,
  countVariant,
  ...rest
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  badge: string;
  count?: number;
  countVariant?: "warning" | "danger" | "success";
  [key: string]: unknown;
}) {
  const countBadgeClass =
    countVariant === "danger"
      ? "badge-danger"
      : countVariant === "warning"
      ? "badge-warning"
      : countVariant === "success"
      ? "badge-success"
      : "badge-neutral";

  return (
    <Link
      href={href}
      className="group relative rounded-2xl bg-card p-5 text-left space-y-3 transition-all hover:-translate-y-0.5 active:scale-[0.97] w-full block"
      style={{ boxShadow: "var(--shadow-card)" }}
      {...(rest as Record<string, string>)}
    >
      <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 z-20 whitespace-nowrap rounded-lg bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        {description}
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-[5px] border-transparent border-t-primary" />
      </span>
      <div className="flex items-start justify-between">
        <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          {icon}
        </div>
        <div className="flex items-center gap-1.5">
          {count != null && count > 0 && (
            <span
              className={`${countBadgeClass} text-[10px] font-bold tracking-wide rounded-full px-2 py-0.5 min-w-5 text-center`}
              data-testid="badge-pendencias"
            >
              {count}
            </span>
          )}
          <span className="badge-neutral text-[10px] font-semibold tracking-wide rounded-full px-2.5 py-0.5">
            {badge}
          </span>
        </div>
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </Link>
  );
}
