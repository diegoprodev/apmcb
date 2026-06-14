"use client";

import { useState } from "react";
import { Shield, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TOTPDisplay } from "@/components/ui/totp-display";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

interface Props {
  configured: boolean;
}

export function TOTPSetupCard({ configured: initialConfigured }: Props) {
  const [configured, setConfigured] = useState(initialConfigured);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(initialConfigured);

  async function setup() {
    setLoading(true);
    try {
      const res = await fetch(`${BFF_URL}/api/totp/setup`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Falha ao configurar");
      setConfigured(true);
      setExpanded(true);
      toast.success("Código de acesso configurado!");
    } catch {
      toast.error("Erro ao configurar código de acesso.");
    } finally {
      setLoading(false);
    }
  }

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
            <Shield className="size-4" />
          </div>
          <div>
            <p className="text-sm font-semibold">Código de Acesso</p>
            <p className="text-xs text-muted-foreground">
              {configured ? "Alternativa à biometria" : "Configure para se armar por código"}
            </p>
          </div>
        </div>
        {configured && (
          <span className="text-xs text-muted-foreground">{expanded ? "▲" : "▼"}</span>
        )}
      </button>

      {!configured && (
        <Button className="w-full" onClick={setup} disabled={loading}>
          {loading ? (
            <><Loader2 className="size-4 mr-2 animate-spin" /> Configurando…</>
          ) : (
            "Configurar Código de Acesso"
          )}
        </Button>
      )}

      {configured && expanded && <TOTPDisplay />}
    </div>
  );
}
