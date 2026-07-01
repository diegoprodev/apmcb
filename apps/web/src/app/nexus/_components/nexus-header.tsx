"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sun, Moon, ChevronDown, User, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { csrfHeaders } from "@/lib/csrf";
import { cn } from "@/lib/utils";
import { useNexusTheme } from "./nexus-theme-context";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

const PAGE_TITLES: Record<string, string> = {
  "/nexus":             "Dashboard",
  "/nexus/tenants":     "Tenants",
  "/nexus/logs":        "Audit Logs",
  "/nexus/erros":       "Erros",
  "/nexus/bff":         "BFF Health",
  "/nexus/usuarios":    "Usuários",
  "/nexus/perfil":      "Meu Perfil",
  "/nexus/superadmins": "Superadmins",
};

interface NexusUser {
  nome_completo: string;
  matricula: string;
  foto_url: string | null;
}

function getInitials(nome: string) {
  return nome.split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

export function NexusHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { dark, toggle } = useNexusTheme();
  const [user, setUser] = useState<NexusUser | null>(null);

  useEffect(() => {
    fetch(`${BFF_URL}/api/nexus/me`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.profile?.nome_completo) {
          setUser({
            nome_completo: d.profile.nome_completo,
            matricula: d.profile.matricula ?? "",
            foto_url: d.profile.foto_url ?? null,
          });
        }
      })
      .catch(() => {});
  }, []);

  const title = PAGE_TITLES[pathname] ?? "Nexus";

  async function handleLogout() {
    await fetch(`${BFF_URL}/api/nexus/logout`, {
      method: "POST",
      credentials: "include",
      headers: csrfHeaders(),
    });
    router.replace("/nexus/login");
  }

  return (
    <header className="h-14 shrink-0 border-b border-gray-200 dark:border-[#1E1E2E] dark:border-gray-200 dark:border-[#1E1E2E] border-gray-200 bg-white dark:bg-[#0D0D14] dark:bg-white dark:bg-[#0D0D14] bg-white flex items-center px-6 gap-4">
      <span className="flex-1 text-sm font-medium dark:text-gray-200 text-gray-700">{title}</span>

      {/* Theme toggle — controla o tema local do Nexus */}
      <Button
        variant="ghost"
        size="icon"
        onClick={toggle}
        aria-label="Alternar tema"
        className="dark:text-gray-500 text-gray-400 dark:hover:text-gray-200 hover:text-gray-700 hover:bg-white/5 dark:hover:bg-white/5"
      >
        {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </Button>

      {/* Avatar dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Menu do perfil"
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 dark:hover:bg-white/5 hover:bg-black/5 transition-colors"
        >
          {user?.foto_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.foto_url}
              alt="Avatar"
              className="size-7 rounded-full object-cover border dark:border-gray-200 dark:border-[#1E1E2E] border-gray-300"
            />
          ) : (
            <div className="size-7 rounded-full bg-indigo-600/30 border border-indigo-500/30 flex items-center justify-center text-[10px] font-bold text-indigo-300">
              {user ? getInitials(user.nome_completo) : <User className="size-3.5" />}
            </div>
          )}
          {user && (
            <span className="text-xs dark:text-gray-300 text-gray-600 max-w-30 truncate hidden sm:block">
              {user.nome_completo.split(" ")[0]}
            </span>
          )}
          <ChevronDown className="size-3.5 dark:text-gray-500 text-gray-400" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className={cn(
            "min-w-[160px] dark:bg-white dark:bg-[#0D0D14] bg-white dark:border-gray-200 dark:border-[#1E1E2E] border-gray-200 dark:text-white text-gray-900",
            "data-open:animate-in data-open:fade-in-0"
          )}
        >
          <DropdownMenuItem
            onClick={() => router.push("/nexus/perfil")}
            className="dark:text-gray-300 text-gray-600 hover:text-gray-900 dark:hover:text-white focus:text-white dark:hover:bg-white/5 hover:bg-black/5 cursor-pointer"
          >
            <User className="size-3.5 mr-2" />
            Meu Perfil
          </DropdownMenuItem>
          <DropdownMenuSeparator className="dark:bg-[#1E1E2E] bg-gray-200" />
          <DropdownMenuItem
            onClick={handleLogout}
            className="text-red-400 hover:text-red-300 focus:text-red-300 hover:bg-red-500/10 cursor-pointer"
          >
            <LogOut className="size-3.5 mr-2" />
            Sair do Nexus
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
