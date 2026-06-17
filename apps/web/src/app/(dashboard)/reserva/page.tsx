export const runtime = 'edge';

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Fingerprint, Package, UserCheck, Clock, TrendingUp, ClipboardList, Shield } from "lucide-react";
import Link from "next/link";
import { VerifyTOTPDialog } from "@/components/reserva/_verify-totp-dialog";

export default async function ArmeiroPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "master" && profile?.role !== "admin") redirect("/");

  // Pending counts
  const { count: activeCount } = await supabase
    .from("lendings")
    .select("id", { count: "exact", head: true })
    .eq("status", "ativo");

  const { count: pendingBiometricCount } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("registration_status", "pending_biometric");

  // SSA pending count (pendente + aprovado not yet delivered)
  const { count: ssaPendingCount } = await supabase
    .from("material_requests")
    .select("id", { count: "exact", head: true })
    .in("status", ["pendente", "aprovado"]);

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
          title="Identificar Militar"
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
          href="/reserva/saidas?status=pendente"
          icon={<Clock className="size-6" />}
          title="Devoluções Pendentes"
          description="Materiais ainda com militares"
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
          href="/reserva/arsenal"
          icon={<Shield className="size-6" />}
          title="Almoxarifado"
          description="Inventário completo de materiais e estoque"
          badge="Estoque"
        />
      </div>

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
  countVariant?: "warning" | "danger";
  [key: string]: unknown;
}) {
  const countBadgeClass =
    countVariant === "danger"
      ? "badge-danger"
      : countVariant === "warning"
      ? "badge-warning"
      : "badge-neutral";

  return (
    <Link
      href={href}
      className="rounded-2xl bg-card p-5 text-left space-y-3 transition-all hover:-translate-y-0.5 active:scale-[0.97] w-full block"
      style={{ boxShadow: "var(--shadow-card)" }}
      {...(rest as Record<string, string>)}
    >
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
