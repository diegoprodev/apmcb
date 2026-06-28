"use client";

import { useState } from "react";
import { Check, Copy, Mail, MessageSquareText } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SUPPORT_EMAIL = "suporteonix@arckosia.com.br";
const SUPPORT_SUBJECT = "APMCB - Suporte e feedback";

type SupportContactCardProps = {
  body: string;
};

export function SupportContactCard({ body }: SupportContactCardProps) {
  const [copied, setCopied] = useState(false);
  const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(SUPPORT_SUBJECT)}&body=${body}`;

  async function copyEmail() {
    await navigator.clipboard.writeText(SUPPORT_EMAIL);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }}>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Mail className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Canal oficial de suporte</p>
            <p className="mt-1 break-all font-mono text-sm text-muted-foreground">{SUPPORT_EMAIL}</p>
            <p className="mt-2 text-sm text-muted-foreground">{"Prazo de resposta: at\u00e9 3 dias \u00fateis."}</p>
          </div>
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Button type="button" variant="outline" onClick={copyEmail} className="h-9 justify-center">
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? "Copiado" : "Copiar email"}
          </Button>
          <a href={mailto} className={cn(buttonVariants({ size: "lg" }), "h-9 justify-center")}>
            <MessageSquareText className="size-4" />
            Enviar email
          </a>
        </div>
      </div>

    </section>
  );
}
