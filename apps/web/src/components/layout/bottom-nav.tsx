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
    { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
    { href: "/admin/usuarios", label: "Usuários", icon: Users },
    { href: "/admin/arsenal", label: "Arsenal", icon: Package },
    { href: "/admin/relatorios", label: "Relatórios", icon: FileText },
  ],
  master: [
    { href: "/reserva", label: "Painel", icon: LayoutDashboard },
    { href: "/reserva/arsenal", label: "Arsenal", icon: Package },
    { href: "/reserva/saidas", label: "Saídas", icon: Shield },
    { href: "/reserva/militares", label: "Usuários", icon: Users },
  ],
  usuario: [
    { href: "/cadete", label: "Materiais", icon: Package },
    { href: "/cadete/historico", label: "Histórico", icon: FileText },
    { href: "/cadete/perfil", label: "Perfil", icon: Users },
  ],
};

export function BottomNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const items = navByRole[role];

  return (
    <nav data-testid="bottom-nav" className="md:hidden fixed bottom-0 inset-x-0 bg-card border-t z-50">
      <div className="flex">
        {items.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex-1 flex flex-col items-center gap-1 py-3 text-[10px] transition-colors rounded-lg active:bg-primary/10",
              pathname.startsWith(href)
                ? "text-primary"
                : "text-muted-foreground hover:text-primary hover:bg-primary/10"
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
