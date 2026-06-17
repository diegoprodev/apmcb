"use client";

import { useState, useEffect, useCallback } from "react";
import { Shield, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { TOTPDisplay } from "@/components/ui/totp-display";
import { csrfHeaders } from "@/lib/csrf";
import { createClient } from "@/lib/supabase/client";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

interface Props {
  configured: boolean;
}

export function TOTPSetupCard({ configured: initialConfigured }: Props) {
  const [configured, setConfigured] = useState(initialConfigured);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(initialConfigured);

  const setup = useCallback(async (silent = false) => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const authHeader: Record<string, string> = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};

      const res = await fetch(`${BFF_URL}/api/totp/setup`, {
        method: "POST",
        credentials: "include",
        headers: { ...authHeader, ...csrfHeaders() },
      });
      if (!res.ok) throw new Error("Falha ao configurar");
      setConfigured(true);
      setExpanded(true);
      if (!silent) toast.success("Código de acesso configurado!");
    } catch {
      if (!silent) toast.error("Erro ao configurar código de acesso.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-configure on first load if not already done
  useEffect(() => {
    if (!initialConfigured) {
      setup(true);
    }
  }, [initialConfigured, setup]);

  return (
    <div
      className="rounded-2xl bg-card p-5 space-y-3"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <button
        className="w-full flex items-center justify-between text-left"
        onClick={() => configured && setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Shield className="size-4" />}
          </div>
          <div>
            <p className="text-sm font-semibold">Código de Acesso</p>
            <p className="text-xs text-muted-foreground">
              {loading
                ? "Configurando código…"
                : configured
                ? "Alternativa à biometria"
                : "Configure para se armar por código"}
            </p>
          </div>
        </div>
        {configured && !loading && (
          <span className="text-xs text-muted-foreground">{expanded ? "▲" : "▼"}</span>
        )}
      </button>

      {configured && expanded && !loading && <TOTPDisplay />}
    </div>
  );
}
