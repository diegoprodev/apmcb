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

type NavChild = { href: string; label: string; icon: React.ElementType };
type NavItem = { href: string; label: string; icon: React.ElementType; children?: NavChild[] };

const navByRole: Record<Role, NavItem[]> = {
  admin: [
    { href: "/admin",           label: "Dashboard",         icon: LayoutDashboard },
    { href: "/admin/comando",   label: "Comando",           icon: BarChart3       },
    { href: "/admin/usuarios",  label: "Usuários",          icon: Users           },
    { href: "/admin/arsenal",   label: "Almoxarifado",      icon: Package         },
    { href: "/admin/estrutura", label: "Estrutura",         icon: Building2       },
    { href: "/admin/livros",    label: "Livros de Serviço", icon: BookOpen        },
    { href: "/admin/relatorios",label: "Relatórios",        icon: FileText        },
    { href: "/admin/auditoria", label: "Auditoria",         icon: Shield          },
  ],
  master: [
    { href: "/reserva",             label: "Painel",            icon: LayoutDashboard },
    { href: "/reserva/arsenal",     label: "Almoxarifado",      icon: Package         },
    { href: "/reserva/saidas",      label: "Saídas",            icon: Shield          },
    { href: "/reserva/cautelas",    label: "Cautelas",          icon: ClipboardList   },
    { href: "/reserva/solicitacoes",label: "Solicitações",      icon: ArrowRightLeft  },
    { href: "/reserva/passagens",   label: "Passagens",         icon: ArrowRightLeft  },
    { href: "/reserva/livro",       label: "Livro de Serviço",  icon: BookOpen        },
    { href: "/reserva/militares",   label: "Usuários",          icon: Users           },
    { href: "/reserva/relatorios",  label: "Relatórios",        icon: FileText        },
  ],
  usuario: [
    {
      href: "/efetivo",
      label: "Painel",
      icon: Package,
      children: [
        { href: "/efetivo/minhas-cautelas", label: "Minhas Cautelas",      icon: ClipboardList },
        { href: "/efetivo/solicitacoes",    label: "Solicitações Remotas", icon: Shield        },
      ],
    },
    { href: "/efetivo/historico", label: "Histórico", icon: FileText },
  ],
};

function isActive(href: string, pathname: string) {
  if (href === "/admin" || href === "/reserva" || href === "/efetivo") return pathname === href;
  return pathname.startsWith(href);
}

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
          {items.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href, pathname);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={closeMobileMenu}
                  data-testid={`nav-item-${item.href.replace(/\//g, "-")}`}
                  className={cn(
                    "flex items-center gap-3 px-5 py-3 text-sm transition-colors",
                    active
                      ? "text-primary bg-primary/8 font-medium border-l-2 border-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  <Icon size={18} className="shrink-0" />
                  {item.label}
                </Link>

                {/* Children always visible with indent (no accordion in mobile) */}
                {item.children?.map((child) => {
                  const ChildIcon = child.icon;
                  const childActive = isActive(child.href, pathname);
                  return (
                    <Link
                      key={child.href}
                      href={child.href}
                      onClick={closeMobileMenu}
                      data-testid={`nav-child-${child.href.replace(/\//g, "-")}`}
                      className={cn(
                        "flex items-center gap-3 pl-11 pr-5 py-2.5 text-sm transition-colors",
                        childActive
                          ? "text-primary bg-primary/8 font-medium border-l-2 border-primary"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                      )}
                    >
                      <ChildIcon size={16} className="shrink-0" />
                      {child.label}
                    </Link>
                  );
                })}
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
