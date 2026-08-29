"use client";

import { ArrowLeftRight, LifeBuoy, LogOut, Menu, Moon, Sun, User } from "lucide-react";
import { useTheme } from "next-themes";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ProfileAvatar } from "@/components/profile-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUIStore } from "@/store/ui.store";
import { useRouter } from "next/navigation";
import { NotificationBell } from "./notification-bell";
import { toast } from "sonner";
import { csrfHeaders } from "@/lib/csrf";
import { signOutAndRedirect } from "@/lib/auth-actions";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

const STAFF_ROLES = ["superadmin", "admin_global", "admin_reserva", "armeiro", "auditor"];

const ROLE_DASHBOARD: Record<string, string> = {
  superadmin:    "/nexus/login",
  admin_global:  "/admin",
  admin_reserva: "/admin",
  armeiro:       "/reserva",
  auditor:       "/admin",
};

interface HeaderProps {
  userName: string;
  userGreeting?: string;
  userId: string;
  photoPath?: string | null;
  dbRole?: string;
  activeMode?: "usuario";
  roleLabel?: string;
}

export function Header({ userName, userGreeting, userId, photoPath, dbRole, activeMode, roleLabel }: HeaderProps) {
  const { theme, setTheme } = useTheme();
  const { toggleMobileMenu } = useUIStore();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  // Achado pré-existente (regra canônica do CLAUDE.md): a lint warning de
  // "setState síncrono dentro de efeito" é o falso-positivo clássico para o
  // guard de hidratação SSR — `theme` do next-themes só existe no client
  // (localStorage), então o servidor sempre renderiza o ícone default
  // (Moon) e o client precisa de 1 render extra pós-hidratação pra saber o
  // tema real (ver uso de `mounted` abaixo, linha ~125). Não é um efeito
  // "sincronizando com sistema externo" no sentido que a regra normalmente
  // pega (nenhum loop de re-render, dispara exatamente 1 vez).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); }, []);

  const isStaff = dbRole && STAFF_ROLES.includes(dbRole);

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

  return (
    <header
      className="h-14 border-b bg-card flex items-center px-4 gap-3 shrink-0"
      style={{ boxShadow: "0 1px 6px rgba(0,0,0,0.06)" }}
    >
      {/* Mobile: abre drawer deslizante. Desktop: colapsa sidebar lateral. */}
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleMobileMenu}
        className="md:hidden"
        aria-label="Abrir menu"
      >
        <Menu size={18} />
      </Button>
      <span className="flex items-center gap-1.5 font-semibold text-sm text-primary md:hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/logo.png" alt="Logo" className="h-6 w-auto" />
      </span>

      {userGreeting && (
        <span className="hidden md:block text-sm text-muted-foreground">
          Olá,{" "}
          <span className="font-semibold text-foreground">{userGreeting}</span>
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        <NotificationBell dbRole={dbRole} activeMode={activeMode} />

        <div className="relative group/theme">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Alternar tema"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {mounted ? (theme === "dark" ? <Sun size={18} /> : <Moon size={18} />) : <Moon size={18} />}
          </Button>
          <span className="pointer-events-none absolute top-full mt-1.5 left-1/2 -translate-x-1/2 z-50 whitespace-nowrap rounded-lg bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground opacity-0 group-hover/theme:opacity-100 transition-opacity duration-150">
            {mounted ? (theme === "dark" ? "Tema claro" : "Tema escuro") : "Alternar tema"}
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 border-[5px] border-transparent border-b-primary" />
          </span>
        </div>

        <DropdownMenu>
          <div className="relative group/avatar">
          <DropdownMenuTrigger className="relative h-8 w-8 rounded-full outline-none">
            <ProfileAvatar
              profileId={userId}
              photoPath={photoPath ?? null}
              name={userName}
              className="h-8 w-8 overflow-hidden"
            />
          </DropdownMenuTrigger>
          <span className="pointer-events-none absolute top-full mt-1.5 left-1/2 -translate-x-1/2 z-50 whitespace-nowrap rounded-lg bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground opacity-0 group-hover/avatar:opacity-100 transition-opacity duration-150">
            {userName}
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 border-[5px] border-transparent border-b-primary" />
          </span>
          </div>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => router.push("/perfil")}>
              <User size={14} className="mr-2" />
              Perfil
            </DropdownMenuItem>

            {isStaff && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleModeToggle}
                  className={activeMode === "usuario" ? "text-amber-600 dark:text-amber-400" : ""}
                >
                  <ArrowLeftRight size={14} className="mr-2" />
                  {activeMode === "usuario"
                    ? `Voltar ao modo ${roleLabel ?? dbRole}`
                    : "Modo Usuário"}
                </DropdownMenuItem>
              </>
            )}

            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/suporte")}>
              <LifeBuoy size={14} className="mr-2" />
              Reportar
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleSignOut}
              className="text-destructive"
            >
              <LogOut size={14} className="mr-2" />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
