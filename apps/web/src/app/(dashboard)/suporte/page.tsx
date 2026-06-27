export const runtime = "edge";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LifeBuoy, Mail, MessageSquareWarning, Star, ThumbsUp } from "lucide-react";

const SUPPORT_EMAIL = "iasuporteonix@arckosia.com.br";

const items = [
  {
    label: "Reportar problema",
    subject: "APMCB - Reporte de problema",
    icon: MessageSquareWarning,
    tone: "text-destructive bg-destructive/10",
  },
  {
    label: "Sugestao",
    subject: "APMCB - Sugestao",
    icon: LifeBuoy,
    tone: "text-primary bg-primary/10",
  },
  {
    label: "Critica",
    subject: "APMCB - Critica",
    icon: Star,
    tone: "text-amber-700 bg-amber-100",
  },
  {
    label: "Elogio",
    subject: "APMCB - Elogio",
    icon: ThumbsUp,
    tone: "text-emerald-700 bg-emerald-100",
  },
];

export default async function SuportePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const body = encodeURIComponent([
    "Descreva aqui o contexto:",
    "",
    "Tela/rota:",
    "Usuario:",
    user.email ?? "",
  ].join("\n"));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Suporte e feedback</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Envie problemas, elogios, criticas e sugestoes para a Arckos IA.
        </p>
      </div>

      <section className="rounded-2xl border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }}>
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map(({ label, subject, icon: Icon, tone }) => (
            <a
              key={label}
              href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${body}`}
              className="flex items-center justify-between rounded-xl border border-border p-4 transition-colors hover:border-primary/40 hover:bg-muted/40"
            >
              <span className="flex items-center gap-3">
                <span className={`flex size-10 items-center justify-center rounded-xl ${tone}`}>
                  <Icon className="size-5" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{label}</span>
                  <span className="text-xs text-muted-foreground">{SUPPORT_EMAIL}</span>
                </span>
              </span>
              <Mail className="size-4 text-muted-foreground" />
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
