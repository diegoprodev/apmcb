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

const navByRole: Record<
  Role,
  { href: string; label: string; icon: React.ElementType }[]
> = {
  admin: [
    { href: "/admin",          label: "Dashboard",       icon: LayoutDashboard },
    { href: "/admin/comando",  label: "Comando",         icon: BarChart3       },
    { href: "/admin/usuarios", label: "Usuários",        icon: Users           },
    { href: "/admin/arsenal",  label: "Arsenal",          icon: Package         },
    { href: "/admin/estrutura",label: "Estrutura",       icon: Building2       },
    { href: "/admin/livros",   label: "Livros de Serviço",icon: BookOpen       },
    { href: "/admin/relatorios",label: "Relatórios",     icon: FileText        },
    { href: "/admin/auditoria",label: "Auditoria",       icon: Shield          },
  ],
  master: [
    { href: "/reserva",           label: "Painel",          icon: LayoutDashboard },
    { href: "/reserva/arsenal",   label: "Almoxarifado",    icon: Package         },
    { href: "/reserva/saidas",    label: "Saídas",          icon: Shield          },
    { href: "/reserva/cautelas",  label: "Cautelas",        icon: ClipboardList   },
    { href: "/reserva/passagens", label: "Passagens",       icon: ArrowRightLeft  },
    { href: "/reserva/livro",     label: "Livro de Serviço",icon: BookOpen        },
    { href: "/reserva/militares", label: "Usuários",        icon: Users           },
    { href: "/reserva/relatorios",label: "Relatórios",      icon: FileText        },
  ],
  usuario: [
    { href: "/efetivo",                label: "Meus Materiais", icon: Package      },
    { href: "/efetivo/minhas-cautelas",label: "Minhas Cautelas",icon: ClipboardList},
    { href: "/efetivo/historico",      label: "Histórico",      icon: FileText     },
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

      <nav className="flex-1 p-2 space-y-1">
        {items.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
              "hover:bg-primary/10 hover:text-primary",
              pathname === href || (href !== "/admin" && href !== "/reserva" && href !== "/efetivo" && pathname.startsWith(href))
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
