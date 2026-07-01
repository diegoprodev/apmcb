"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { csrfHeaders } from "@/lib/csrf";
import {
  LayoutDashboard,
  ScrollText,
  AlertTriangle,
  Server,
  Users,
  Building2,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

const NAV = [
  { href: "/nexus", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/nexus/tenants", label: "Tenants", icon: Building2 },
  { href: "/nexus/logs", label: "Audit Logs", icon: ScrollText },
  { href: "/nexus/erros", label: "Erros", icon: AlertTriangle },
  { href: "/nexus/bff", label: "BFF Health", icon: Server },
  { href: "/nexus/usuarios", label: "Usuários", icon: Users },
  { href: "/nexus/superadmins", label: "Superadmins", icon: ShieldCheck },
];

export function NexusSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

  async function handleLogout() {
    await fetch(`${BFF_URL}/api/nexus/logout`, {
      method: "POST",
      credentials: "include",
      headers: csrfHeaders(),
    });
    router.replace("/nexus/login");
  }

  return (
    <aside
      className={cn(
        "shrink-0 flex flex-col border-r border-gray-200 dark:border-[#1E1E2E] bg-white dark:bg-[#0D0D14] h-screen sticky top-0 transition-all duration-200",
        collapsed ? "w-14" : "w-56"
      )}
    >
      {/* Logo + collapse */}
      <div className="flex items-center border-b border-gray-200 dark:border-[#1E1E2E] px-3 py-4 gap-2">
        <Image src="/images/logo.png" alt="Logo" width={24} height={24} className="shrink-0" />
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-white truncate">Controle</p>
            <p className="text-[10px] text-indigo-400 font-mono">NEXUS</p>
          </div>
        )}
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="text-gray-500 hover:text-gray-300 transition-colors shrink-0"
          title={collapsed ? "Expandir sidebar" : "Recolher sidebar"}
        >
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 space-y-0.5 px-2">
        {NAV.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={cn(
                "flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm transition-colors",
                collapsed ? "justify-center" : "",
                active
                  ? "bg-indigo-600/20 text-indigo-300 font-medium"
                  : "text-gray-400 hover:text-gray-200 hover:bg-white/5"
              )}
            >
              <Icon className="size-4 shrink-0" />
              {!collapsed && label}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="p-2 border-t border-gray-200 dark:border-[#1E1E2E]">
        <button
          onClick={handleLogout}
          title={collapsed ? "Sair do Nexus" : undefined}
          className={cn(
            "flex items-center gap-2.5 w-full px-2 py-2 rounded-lg text-sm text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors",
            collapsed ? "justify-center" : ""
          )}
        >
          <LogOut className="size-4 shrink-0" />
          {!collapsed && "Sair do Nexus"}
        </button>
      </div>
    </aside>
  );
}
