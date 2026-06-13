"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, Package, FileText, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Role } from "@/hooks/use-role";

const navByRole: Record<
  Role,
  { href: string; label: string; icon: React.ElementType }[]
> = {
  admin: [
    { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/admin/usuarios", label: "Usuários", icon: Users },
    { href: "/admin/arsenal", label: "Arsenal", icon: Package },
    { href: "/admin/relatorios", label: "Relatórios", icon: FileText },
  ],
  master: [
    { href: "/master/armar", label: "Armar", icon: Shield },
    { href: "/master/painel", label: "Painel", icon: LayoutDashboard },
    { href: "/master/militares", label: "Militares", icon: Users },
  ],
  military: [
    { href: "/militar/perfil", label: "Perfil", icon: Users },
    { href: "/militar/materiais", label: "Materiais", icon: Package },
    { href: "/militar/historico", label: "Histórico", icon: FileText },
  ],
};

export function BottomNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const items = navByRole[role];

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 bg-card border-t z-50">
      <div className="flex">
        {items.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex-1 flex flex-col items-center gap-1 py-3 text-[10px] transition-colors",
              pathname.startsWith(href)
                ? "text-primary"
                : "text-muted-foreground"
            )}
          >
            <Icon size={20} />
            <span>{label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
