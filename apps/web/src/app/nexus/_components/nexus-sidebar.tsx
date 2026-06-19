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
  LogOut,
} from "lucide-react";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

const NAV = [
  { href: "/nexus", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/nexus/logs", label: "Audit Logs", icon: ScrollText },
  { href: "/nexus/erros", label: "Erros", icon: AlertTriangle },
  { href: "/nexus/bff", label: "BFF Health", icon: Server },
  { href: "/nexus/usuarios", label: "Usuários", icon: Users },
];

export function NexusSidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch(`${BFF_URL}/api/nexus/logout`, {
      method: "POST",
      credentials: "include",
      headers: csrfHeaders(),
    });
    router.replace("/nexus/login");
  }

  return (
    <aside className="w-56 shrink-0 flex flex-col border-r border-[#1E1E2E] bg-[#0D0D14] h-screen sticky top-0">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-5 border-b border-[#1E1E2E]">
        <Image src="/images/logo.png" alt="APMCB" width={24} height={24} />
        <div>
          <p className="text-xs font-semibold text-white">APMCB</p>
          <p className="text-[10px] text-indigo-400 font-mono">NEXUS</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 space-y-0.5 px-2">
        {NAV.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                active
                  ? "bg-indigo-600/20 text-indigo-300 font-medium"
                  : "text-gray-400 hover:text-gray-200 hover:bg-white/5"
              }`}
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="p-3 border-t border-[#1E1E2E]">
        <button
          onClick={handleLogout}
          className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <LogOut className="size-4 shrink-0" />
          Sair do Nexus
        </button>
      </div>
    </aside>
  );
}
