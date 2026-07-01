"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/store/ui.store";
import { Button } from "@/components/ui/button";
import type { Role } from "@/hooks/use-role";
import {
  LayoutDashboard, Users, Package, FileText, Shield,
  ClipboardList, BarChart3, Building2, ArrowRightLeft,
  BookOpen,
} from "lucide-react";

const navByRole: Record<Role, { href: string; label: string; icon: React.ElementType }[]> = {
  admin: [
    { href: "/admin",           label: "Dashboard",        icon: LayoutDashboard },
    { href: "/admin/comando",   label: "Comando",          icon: BarChart3       },
    { href: "/admin/usuarios",  label: "Usuários",         icon: Users           },
    { href: "/admin/arsenal",   label: "Almoxarifado",     icon: Package         },
    { href: "/admin/estrutura", label: "Estrutura",        icon: Building2       },
    { href: "/admin/livros",    label: "Livros de Serviço",icon: BookOpen        },
    { href: "/admin/relatorios",label: "Relatórios",       icon: FileText        },
    { href: "/admin/auditoria", label: "Auditoria",        icon: Shield          },
  ],
  master: [
    { href: "/reserva",            label: "Painel",           icon: LayoutDashboard },
    { href: "/reserva/arsenal",    label: "Almoxarifado",     icon: Package         },
    { href: "/reserva/saidas",     label: "Saídas",           icon: Shield          },
    { href: "/reserva/cautelas",   label: "Cautelas",         icon: ClipboardList   },
    { href: "/reserva/passagens",  label: "Passagens",        icon: ArrowRightLeft  },
    { href: "/reserva/livro",      label: "Livro de Serviço", icon: BookOpen        },
    { href: "/reserva/militares",  label: "Usuários",         icon: Users           },
    { href: "/reserva/relatorios", label: "Relatórios",       icon: FileText        },
  ],
  usuario: [
    { href: "/efetivo",                 label: "Meus Materiais",  icon: Package       },
    { href: "/efetivo/minhas-cautelas", label: "Minhas Cautelas", icon: ClipboardList },
    { href: "/efetivo/historico",       label: "Histórico",       icon: FileText      },
  ],
};

interface MobileNavProps {
  role: Role;
}

export function MobileNav({ role }: MobileNavProps) {
  const pathname = usePathname();
  const { mobileMenuOpen, closeMobileMenu } = useUIStore();
  const items = navByRole[role] ?? [];

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={closeMobileMenu}
        className={cn(
          "md:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-300",
          mobileMenuOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
      />

      {/* Drawer — desliza de cima para baixo */}
      <nav
        aria-label="Menu principal"
        className={cn(
          "md:hidden fixed left-0 right-0 top-14 z-50",
          "bg-card border-b shadow-xl",
          "transition-transform duration-300 ease-in-out",
          mobileMenuOpen ? "translate-y-0" : "-translate-y-[110%]"
        )}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Menu
          </span>
          <Button variant="ghost" size="icon" onClick={closeMobileMenu}>
            <X size={18} />
          </Button>
        </div>

        <ul className="py-2">
          {items.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== "/admin" && href !== "/reserva" && href !== "/efetivo" && pathname.startsWith(href));
            return (
              <li key={href}>
                <Link
                  href={href}
                  onClick={closeMobileMenu}
                  className={cn(
                    "flex items-center gap-3 px-5 py-3 text-sm transition-colors",
                    active
                      ? "text-primary bg-primary/8 font-medium border-l-2 border-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  <Icon size={18} className="shrink-0" />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
