"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Users,
  Package,
  FileText,
  Shield,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ClipboardList,
  BarChart3,
  Building2,
  ArrowRightLeft,
  BookOpen,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/store/ui.store";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Role } from "@/hooks/use-role";

type NavChild = { href: string; label: string; icon: React.ElementType };
type NavItem = { href: string; label: string; icon: React.ElementType; children?: NavChild[] };

const navByRole: Record<Role, NavItem[]> = {
  admin: [
    { href: "/admin",           label: "Dashboard",          icon: LayoutDashboard },
    { href: "/admin/comando",   label: "Comando",            icon: BarChart3       },
    { href: "/admin/usuarios",  label: "Usuários",           icon: Users           },
    { href: "/admin/arsenal",   label: "Arsenal",            icon: Package         },
    { href: "/admin/saidas",    label: "Saídas",             icon: ArrowRightLeft  },
    { href: "/admin/estrutura", label: "Estrutura",          icon: Building2       },
    { href: "/admin/livros",    label: "Livros de Serviço",  icon: BookOpen        },
    { href: "/admin/relatorios",label: "Relatórios",         icon: FileText        },
    { href: "/admin/auditoria", label: "Auditoria",          icon: Shield          },
  ],
  master: [
    { href: "/reserva",             label: "Painel",           icon: LayoutDashboard },
    { href: "/reserva/arsenal",     label: "Almoxarifado",     icon: Package         },
    { href: "/reserva/saidas",      label: "Saídas",           icon: Shield          },
    { href: "/reserva/cautelas",    label: "Cautelas",         icon: ClipboardList   },
    { href: "/reserva/solicitacoes",label: "Solicitações",     icon: ArrowRightLeft  },
    { href: "/reserva/passagens",   label: "Passagens",        icon: ArrowRightLeft  },
    { href: "/reserva/livro",       label: "Livro de Serviço", icon: BookOpen        },
    { href: "/reserva/militares",   label: "Usuários",         icon: Users           },
    { href: "/reserva/relatorios",  label: "Relatórios",       icon: FileText        },
  ],
  usuario: [
    {
      href: "/efetivo",
      label: "Meus Materiais",
      icon: Package,
      children: [
        { href: "/efetivo/minhas-cautelas", label: "Minhas Cautelas",      icon: ClipboardList },
        { href: "/efetivo/solicitacoes",    label: "Solicitações Remotas", icon: Shield        },
      ],
    },
    { href: "/efetivo/historico", label: "Histórico", icon: FileText },
  ],
};

interface SidebarProps {
  role: Role;
  reserveLogoUrl?: string | null;
  reserveName?: string | null;
  reserves?: { id: string; nome: string; acronym: string }[];
  currentReserveId?: string | null;
}

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

function isActive(href: string, pathname: string) {
  if (href === "/admin" || href === "/reserva" || href === "/efetivo") return pathname === href;
  return pathname.startsWith(href);
}

export function Sidebar({
  role,
  reserveLogoUrl,
  reserveName,
  reserves = [],
  currentReserveId,
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { sidebarOpen, toggleSidebar } = useUIStore();
  const items = navByRole[role];
  const [switching, setSwitching] = useState(false);

  // Auto-open groups where a child is active
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    items.forEach((item) => {
      if (item.children?.some((c) => isActive(c.href, pathname))) {
        initial.add(item.href);
      }
    });
    return initial;
  });

  function toggleGroup(href: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      next.has(href) ? next.delete(href) : next.add(href);
      return next;
    });
  }

  const canSwitch = reserves.length > 1;
  const displayName = reserveName ?? "Reserva";

  async function switchReserve(reserveId: string) {
    if (reserveId === currentReserveId || switching) return;
    setSwitching(true);
    try {
      await fetch(`${BFF_URL}/api/reserves/switch/${reserveId}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      router.refresh();
    } finally {
      setSwitching(false);
    }
  }

  const linkClass = (href: string) =>
    cn(
      "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
      "hover:bg-primary/10 hover:text-primary",
      isActive(href, pathname) ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground"
    );

  return (
    <aside
      className={cn(
        "hidden md:flex flex-col border-r bg-card transition-all duration-300",
        sidebarOpen ? "w-56" : "w-16"
      )}
      style={{ boxShadow: "1px 0 6px rgba(0,0,0,0.06)" }}
    >
      <div className="flex items-center justify-between p-4 border-b min-h-16">
        <Button
          variant="ghost"
          size="icon"
          aria-label={sidebarOpen ? "Recolher menu" : "Expandir menu"}
          onClick={toggleSidebar}
          className={cn("shrink-0", sidebarOpen ? "order-2" : "mx-auto")}
        >
          {sidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </Button>
        {sidebarOpen && (
          <div className="order-1 flex min-w-0 flex-1 items-center gap-2">
            {reserveLogoUrl
              ? <img src={reserveLogoUrl} alt="Logo da Reserva" width={32} height={32} className="rounded-md shrink-0 object-contain" />
              : <Image src="/images/logo.png" alt="Logo" width={32} height={32} className="rounded-md shrink-0" />
            }

            {canSwitch ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  disabled={switching}
                  className="flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-left text-sm font-semibold text-primary hover:bg-primary/10 transition-colors outline-none"
                >
                  <span className="truncate leading-tight">{displayName}</span>
                  <ChevronDown className="size-3.5 shrink-0 opacity-60" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-52">
                  {reserves.map((r) => (
                    <DropdownMenuItem
                      key={r.id}
                      onClick={() => switchReserve(r.id)}
                      className="flex items-center gap-2"
                    >
                      <span className="flex-1 truncate">{r.nome}</span>
                      {r.id === currentReserveId && <Check className="size-3.5 text-primary" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="truncate font-semibold text-sm text-primary leading-tight">
                {displayName}
              </span>
            )}
          </div>
        )}
      </div>

      <nav className="flex-1 p-2 space-y-0.5">
        {items.map((item) => {
          const Icon = item.icon;
          const hasChildren = !!item.children?.length;
          const isGroupOpen = openGroups.has(item.href);
          const parentActive = isActive(item.href, pathname) || (hasChildren && item.children!.some((c) => isActive(c.href, pathname)));

          if (!hasChildren) {
            return (
              <Link key={item.href} href={item.href} className={linkClass(item.href)}>
                <Icon size={18} className="shrink-0" />
                {sidebarOpen && <span>{item.label}</span>}
              </Link>
            );
          }

          // Item with accordion children
          if (!sidebarOpen) {
            // Collapsed: show parent icon + children icons directly
            return (
              <div key={item.href} className="space-y-0.5">
                <Link href={item.href} className={linkClass(item.href)}>
                  <Icon size={18} className="mx-auto shrink-0" />
                </Link>
                {item.children!.map((child) => {
                  const ChildIcon = child.icon;
                  return (
                    <Link key={child.href} href={child.href} className={linkClass(child.href)}>
                      <ChildIcon size={16} className="mx-auto shrink-0" />
                    </Link>
                  );
                })}
              </div>
            );
          }

          // Expanded: accordion group
          return (
            <div key={item.href}>
              <div className={cn(
                "flex items-center rounded-lg transition-colors",
                parentActive ? "text-primary" : "text-muted-foreground"
              )}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex flex-1 items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors hover:bg-primary/10 hover:text-primary",
                    parentActive ? "text-primary font-medium" : "text-muted-foreground"
                  )}
                >
                  <Icon size={18} className="shrink-0" />
                  <span className="flex-1">{item.label}</span>
                </Link>
                <button
                  onClick={() => toggleGroup(item.href)}
                  data-testid={`accordion-toggle-${item.href.replace(/\//g, "-")}`}
                  className="px-2 py-2 rounded-lg hover:bg-primary/10 hover:text-primary transition-colors"
                  aria-label={isGroupOpen ? "Fechar grupo" : "Abrir grupo"}
                >
                  <ChevronDown
                    size={13}
                    className={cn("transition-transform duration-200 shrink-0", isGroupOpen && "rotate-180")}
                  />
                </button>
              </div>

              {isGroupOpen && (
                <div className="mt-0.5 space-y-0.5 pl-2">
                  {item.children!.map((child) => {
                    const ChildIcon = child.icon;
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        data-testid={`nav-child-${child.href.replace(/\//g, "-")}`}
                        className={cn(
                          "flex items-center gap-3 pl-7 pr-3 py-1.5 rounded-lg text-sm transition-colors hover:bg-primary/10 hover:text-primary",
                          isActive(child.href, pathname) ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground"
                        )}
                      >
                        <ChildIcon size={15} className="shrink-0" />
                        <span>{child.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
