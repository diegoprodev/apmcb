"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Package,
  FileText,
  Shield,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/store/ui.store";
import { Button } from "@/components/ui/button";
import type { Role } from "@/hooks/use-role";

const navByRole: Record<
  Role,
  { href: string; label: string; icon: React.ElementType }[]
> = {
  admin: [
    { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
    { href: "/admin/usuarios", label: "Usuários", icon: Users },
    { href: "/admin/arsenal", label: "Arsenal", icon: Package },
    { href: "/admin/relatorios", label: "Relatórios", icon: FileText },
    { href: "/admin/auditoria", label: "Auditoria", icon: Shield },
  ],
  master: [
    { href: "/armeiro", label: "Painel", icon: LayoutDashboard },
    { href: "/armeiro/saidas", label: "Saídas", icon: Shield },
    { href: "/armeiro/militares", label: "Militares", icon: Users },
    { href: "/armeiro/relatorios", label: "Relatórios", icon: FileText },
  ],
  military: [
    { href: "/cadete", label: "Meus Materiais", icon: Package },
    { href: "/cadete/historico", label: "Histórico", icon: FileText },
    { href: "/cadete/perfil", label: "Meu Perfil", icon: Users },
  ],
};

interface SidebarProps {
  role: Role;
}

export function Sidebar({ role }: SidebarProps) {
  const pathname = usePathname();
  const { sidebarOpen, toggleSidebar } = useUIStore();
  const items = navByRole[role];

  return (
    <aside
      className={cn(
        "hidden md:flex flex-col border-r bg-card transition-all duration-300",
        sidebarOpen ? "w-56" : "w-16"
      )}
      style={{ boxShadow: "1px 0 6px rgba(0,0,0,0.06)" }}
    >
      <div className="flex items-center justify-between p-4 border-b">
        {sidebarOpen && (
          <div className="flex items-center gap-2">
            <Image src="/images/logo.png" alt="APMCB" width={32} height={32} className="rounded-md shrink-0" />
            <span className="font-semibold text-sm text-primary leading-tight">APMCB</span>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          className="ml-auto"
        >
          {sidebarOpen ? (
            <ChevronLeft size={16} />
          ) : (
            <ChevronRight size={16} />
          )}
        </Button>
      </div>

      <nav className="flex-1 p-2 space-y-1">
        {items.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
              "hover:bg-primary/10 hover:text-primary",
              pathname === href || (href !== "/admin" && href !== "/armeiro" && href !== "/cadete" && pathname.startsWith(href))
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground"
            )}
          >
            <Icon size={18} className="shrink-0" />
            {sidebarOpen && <span>{label}</span>}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
