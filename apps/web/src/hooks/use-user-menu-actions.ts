"use client";

import { toast } from "sonner";
import { csrfHeaders } from "@/lib/csrf";
import { signOutAndRedirect } from "@/lib/auth-actions";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

const STAFF_ROLES = ["superadmin", "admin_global", "admin_reserva", "armeiro", "auditor"];

const ROLE_DASHBOARD: Record<string, string> = {
  superadmin: "/nexus/login",
  admin_global: "/admin",
  admin_reserva: "/admin",
  armeiro: "/reserva",
  auditor: "/admin",
};

/**
 * Ações do menu de perfil (Modo Usuário + Sair), compartilhadas entre o
 * dropdown mobile (header.tsx) e o card de perfil do sidebar desktop
 * (layout/sidebar.tsx) — mesma lógica de negócio, UI própria em cada lugar.
 */
export function useUserMenuActions(dbRole?: string, activeMode?: "usuario") {
  const isStaff = !!dbRole && STAFF_ROLES.includes(dbRole);

  async function handleSignOut() {
    await signOutAndRedirect();
  }

  async function handleModeToggle() {
    const targetMode = activeMode === "usuario" ? "staff" : "usuario";
    const label = targetMode === "usuario" ? "Modo Usuário" : "modo Armeiro";
    toast.loading(`Ativando ${label}…`, { id: "mode-toggle" });
    try {
      // Chama o BFF diretamente para que a iron-session seja atualizada no browser.
      // O proxy Next.js (/api/mode) não conseguia propagar o Set-Cookie da iron-session,
      // deixando session.activeMode desatualizado e causando 403 nos endpoints do modo usuário.
      const res = await fetch(`${BFF_URL}/api/session/mode`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...csrfHeaders(),
        },
        body: JSON.stringify({ mode: targetMode }),
      });
      if (!res.ok) {
        toast.error("Não foi possível trocar o modo. Tente novamente.", { id: "mode-toggle" });
        return;
      }
      toast.success(`${targetMode === "usuario" ? "Modo Usuário ativado" : "Voltou ao modo Armeiro"}`, { id: "mode-toggle" });
      // Full page load para o layout SSR re-ler os cookies de modo
      window.location.href = targetMode === "usuario"
        ? "/efetivo"
        : (ROLE_DASHBOARD[dbRole ?? ""] ?? "/");
    } catch {
      toast.error("Erro ao trocar o modo. Tente novamente.", { id: "mode-toggle" });
    }
  }

  return { isStaff, handleSignOut, handleModeToggle };
}
