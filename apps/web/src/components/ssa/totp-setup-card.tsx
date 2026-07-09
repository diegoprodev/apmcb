"use client";

import { useState, useEffect, useRef } from "react";
import { Shield, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { TOTPDisplay } from "@/components/ui/totp-display";
import { bffFetch } from "@/lib/bff-client";

interface Props {
  configured: boolean;
}

export function TOTPSetupCard({ configured: initialConfigured }: Props) {
  const [configured, setConfigured] = useState(initialConfigured);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const didAutoSetup = useRef(false);

  // Auto-configura silenciosamente apenas se ainda não tem TOTP
  useEffect(() => {
    if (initialConfigured || didAutoSetup.current) return;
    didAutoSetup.current = true;

    const run = async () => {
      setLoading(true);
      try {
        const res = await bffFetch("POST", "/api/totp/setup");
        if (!res.ok) throw new Error();
        setConfigured(true);
        setExpanded(true);
      } catch {
        toast.error("Erro ao configurar código de acesso. Tente recarregar a página.");
      } finally {
        setLoading(false);
      }
    };

    run();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canExpand = configured && !loading;

  function handleToggle() {
    if (!canExpand) return;
    setExpanded((v) => !v);
  }

  return (
    <div
      data-testid="totp-setup-card"
      className="rounded-2xl bg-card overflow-hidden"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <button
        type="button"
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left cursor-pointer select-none"
        onClick={handleToggle}
        aria-expanded={expanded}
        disabled={!canExpand}
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Shield className="size-4" />}
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">Código de Acesso</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {loading
                ? "Configurando código…"
                : configured
                ? expanded ? "Toque para ocultar" : "Toque para ver seu código"
                : "Configure para se armar por código"}
            </p>
          </div>
        </div>
        {canExpand && (
          expanded
            ? <ChevronUp  className="size-4 text-muted-foreground shrink-0" />
            : <ChevronDown className="size-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {expanded && canExpand && (
        <div className="px-5 pb-5">
          <TOTPDisplay />
        </div>
      )}
    </div>
  );
}
