import Link from "next/link";
import Image from "next/image";
import { AlertTriangle, MailX, ShieldX, Clock } from "lucide-react";

type SearchParams = Promise<{ reason?: string }>;

const MESSAGES: Record<string, {
  icon: "MailX" | "Clock" | "ShieldX" | "AlertTriangle";
  title: string;
  description: string;
  showContactNote: boolean;
}> = {
  otp_expired: {
    icon: "MailX",
    title: "Link de convite expirado",
    description: "O link de convite que você clicou expirou. Links de convite têm validade limitada.",
    showContactNote: true,
  },
  access_denied: {
    icon: "MailX",
    title: "Link inválido ou expirado",
    description: "O link de acesso expirou ou já foi utilizado. Se você ainda não ativou sua conta, solicite um novo convite.",
    showContactNote: true,
  },
  invite_expired: {
    icon: "MailX",
    title: "Convite expirado",
    description: "O convite expirou antes de ser usado. Solicite um novo convite ao administrador do sistema.",
    showContactNote: true,
  },
  email_not_confirmed: {
    icon: "Clock",
    title: "E-mail não confirmado",
    description: "Seu e-mail ainda não foi confirmado. Verifique sua caixa de entrada ou solicite um novo convite.",
    showContactNote: false,
  },
};

const ICONS = {
  MailX,
  Clock,
  ShieldX,
  AlertTriangle,
};

export default async function AuthErrorPage({ searchParams }: { searchParams: SearchParams }) {
  const { reason } = await searchParams;
  const config = reason ? MESSAGES[reason] : null;

  const IconComponent = config ? ICONS[config.icon] : AlertTriangle;
  const title = config?.title ?? "Falha na autenticação";
  const description = config?.description ?? "Não foi possível completar o login. Verifique o link e tente novamente.";

  return (
    <div className="min-h-dvh flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-100">
        <div className="flex items-center gap-3 mb-8">
          <Image src="/images/logo.png" alt="APMCB" width={32} height={32} className="shrink-0" priority />
          <span className="text-sm font-semibold text-gray-800 tracking-wide">APMCB</span>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center">
              <IconComponent className="size-6 text-red-500" />
            </div>

            <div className="space-y-1">
              <p className="font-semibold text-gray-900">{title}</p>
              <p className="text-sm text-gray-500 leading-relaxed">{description}</p>
            </div>

            <div className="w-full space-y-2 pt-1">
              <Link
                href="/login"
                className="flex items-center justify-center w-full h-11 rounded-xl text-sm font-semibold bg-[#1B3A8C] hover:bg-[#162f73] text-white transition-colors"
              >
                Ir para o login
              </Link>
              {config?.showContactNote && (
                <p className="text-xs text-gray-400 leading-relaxed">
                  Para solicitar um novo convite, entre em contato com a Reserva de Armamento.
                </p>
              )}
            </div>
          </div>
        </div>

        <p className="text-xs text-center text-gray-400 mt-6">
          APMCB Control System · by Arckos IA
        </p>
      </div>
    </div>
  );
}
