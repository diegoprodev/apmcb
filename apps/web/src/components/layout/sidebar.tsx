"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import {
  LayoutDashboard,
  Users,
  Package,
  FileText,
  Shield,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  ClipboardList,
  BarChart3,
  Building2,
  ArrowRightLeft,
  BookOpen,
  Check,
  Wrench,
  MessageSquareWarning,
  User,
  LifeBuoy,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { csrfHeaders } from "@/lib/csrf";
import { useUIStore } from "@/store/ui.store";
import { buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProfileAvatar } from "@/components/profile-avatar";
import { useUserMenuActions } from "@/hooks/use-user-menu-actions";
import { SidebarProvider, SidebarBody, SidebarLink } from "@/components/ui/sidebar";
import type { Role } from "@/hooks/use-role";

type NavChild = { href: string; label: string; icon: React.ElementType };
type NavItem = { href: string; label: string; icon: React.ElementType; children?: NavChild[] };

const navByRole: Record<Role, NavItem[]> = {
  admin: [
    { href: "/admin",           label: "Dashboard",          icon: LayoutDashboard },
    { href: "/admin/comando",   label: "Comando",            icon: BarChart3       },
    { href: "/admin/usuarios",  label: "Usuários",           icon: Users           },
    {
      href: "/admin/arsenal",
      label: "Arsenal",
      icon: Package,
      children: [
        { href: "/admin/arsenal",            label: "Materiais",  icon: Package },
        { href: "/admin/arsenal/manutencao", label: "Manutenção", icon: Wrench  },
      ],
    },
    { href: "/admin/saidas",    label: "Saídas",             icon: ArrowRightLeft  },
    { href: "/admin/estrutura", label: "Estrutura",          icon: Building2       },
    { href: "/admin/livros",    label: "Livros de Serviço",  icon: BookOpen        },
    { href: "/admin/relatorios",label: "Relatórios",         icon: FileText        },
    { href: "/admin/auditoria", label: "Auditoria",          icon: Shield          },
  ],
  master: [
    { href: "/reserva",             label: "Painel",           icon: LayoutDashboard },
    {
      href: "/reserva/arsenal",
      label: "Almoxarifado",
      icon: Package,
      children: [
        { href: "/reserva/arsenal",            label: "Materiais",  icon: Package },
        { href: "/reserva/arsenal/manutencao", label: "Manutenção", icon: Wrench  },
      ],
    },
    { href: "/reserva/saidas",      label: "Saídas",           icon: Shield          },
    { href: "/reserva/cautelas",    label: "Cautelas",         icon: ClipboardList   },
    { href: "/reserva/solicitacoes",label: "Solicitações",     icon: ArrowRightLeft  },
    { href: "/reserva/passagens",   label: "Passagens",        icon: ArrowRightLeft  },
    { href: "/reserva/livro",       label: "Livro de Serviço", icon: BookOpen        },
    { href: "/reserva/militares",   label: "Usuários",         icon: Users           },
    { href: "/reserva/relatorios",  label: "Relatórios",       icon: FileText        },
  ],
  usuario: [
    { href: "/efetivo", label: "Painel", icon: LayoutDashboard },
    {
      href: "/efetivo/minhas-cautelas",
      label: "Meus Materiais",
      icon: Package,
      children: [
        { href: "/efetivo/minhas-cautelas", label: "Minhas Cautelas",      icon: ClipboardList },
        { href: "/efetivo/solicitacoes",    label: "Solicitações Remotas", icon: Shield        },
        { href: "/efetivo/ocorrencias",     label: "Ocorrências",          icon: MessageSquareWarning },
      ],
    },
    { href: "/efetivo/historico", label: "Histórico", icon: FileText },
  ],
};

interface SidebarProps {
  role: Role;
  /** papel real do banco (admin_global/admin_reserva/armeiro/auditor/usuario) —
   *  `role` acima é o papel de UI, agrupado (admin/master/usuario). */
  dbRole?: string;
  reserveLogoUrl?: string | null;
  reserveName?: string | null;
  reserves?: { id: string; nome: string; acronym: string }[];
  currentReserveId?: string | null;
  userName: string;
  userId: string;
  photoPath?: string | null;
  activeMode?: "usuario";
  roleLabel?: string;
}

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

// Hrefs cujo match deve ser EXATO, não por prefixo: são raízes de dashboard
// (/admin, /reserva, /efetivo) ou hrefs de grupo reusados como href do
// primeiro filho (ex: "/admin/arsenal" é tanto o grupo "Arsenal" quanto o
// filho "Materiais") — sem isso, "/admin/arsenal".startsWith(...) casaria
// também com a rota irmã "/admin/arsenal/manutencao", destacando os dois
// itens do menu ao mesmo tempo.
const EXACT_MATCH_HREFS = new Set(["/admin", "/reserva", "/efetivo", "/admin/arsenal", "/reserva/arsenal"]);

function isActive(href: string, pathname: string) {
  if (EXACT_MATCH_HREFS.has(href)) return pathname === href;
  return pathname.startsWith(href);
}

function NavGroup({
  item,
  pathname,
  visuallyOpen,
  isGroupOpen,
  onToggle,
}: {
  item: NavItem;
  pathname: string;
  visuallyOpen: boolean;
  isGroupOpen: boolean;
  onToggle: () => void;
}) {
  const Icon = item.icon;
  const parentActive = isActive(item.href, pathname) || item.children!.some((c) => isActive(c.href, pathname));

  if (!visuallyOpen) {
    // Rail colapsado: pilha compacta de ícones (pai + filhos), sem chevron —
    // hover no sidebar já expande e revela os rótulos reais.
    return (
      <div className="flex flex-col gap-0.5">
        <Link href={item.href} className={cn(
          "flex items-center justify-center rounded-[6px] px-3 py-2 transition-colors hover:bg-primary/10 hover:text-primary",
          parentActive ? "bg-primary/10 text-primary" : "text-muted-foreground"
        )}>
          <Icon size={18} className="shrink-0" />
        </Link>
        {item.children!.map((child) => {
          const ChildIcon = child.icon;
          return (
            <Link
              key={child.href}
              href={child.href}
              data-testid={`nav-child-${child.href.replace(/\//g, "-")}`}
              className={cn(
                "flex items-center justify-center rounded-[6px] px-3 py-1.5 transition-colors hover:bg-primary/10 hover:text-primary",
                isActive(child.href, pathname) ? "bg-primary/10 text-primary" : "text-muted-foreground"
              )}
            >
              <ChildIcon size={16} className="shrink-0" />
            </Link>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col">
      <div className={cn(
        "flex items-center rounded-[6px] transition-colors",
        parentActive ? "text-primary" : "text-muted-foreground"
      )}>
        <Link
          href={item.href}
          className={cn(
            "flex flex-1 items-center gap-3 rounded-[6px] px-3 py-2 text-[13px] transition-colors hover:bg-primary/10 hover:text-primary",
            parentActive ? "text-primary font-medium" : "text-muted-foreground"
          )}
        >
          <Icon size={18} className="shrink-0" />
          <span className="flex-1 truncate">{item.label}</span>
        </Link>
        <button
          onClick={onToggle}
          data-testid={`accordion-toggle-${item.href.replace(/\//g, "-")}`}
          className="rounded-[6px] px-2 py-2 transition-colors hover:bg-primary/10 hover:text-primary"
          aria-label={isGroupOpen ? "Fechar grupo" : "Abrir grupo"}
        >
          <ChevronDown
            size={13}
            className={cn("shrink-0 transition-transform duration-200", isGroupOpen && "rotate-180")}
          />
        </button>
      </div>

      {/* Grid-rows anima altura de 0→auto sem precisar medir px (técnica
          CSS pura — evita jank de height:auto e mantém os filhos montados,
          só clipados via overflow-hidden quando fechado). */}
      <div className={cn(
        "grid transition-[grid-template-rows] duration-300 ease-in-out",
        isGroupOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
      )}>
        <div className="flex min-h-0 flex-col gap-0.5 overflow-hidden pl-2 pt-0.5">
          {item.children!.map((child) => {
            const ChildIcon = child.icon;
            return (
              <Link
                key={child.href}
                href={child.href}
                data-testid={`nav-child-${child.href.replace(/\//g, "-")}`}
                className={cn(
                  "flex items-center gap-3 rounded-[6px] py-1.5 pl-7 pr-3 text-[13px] transition-colors hover:bg-primary/10 hover:text-primary",
                  isActive(child.href, pathname) ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground"
                )}
              >
                <ChildIcon size={15} className="shrink-0" />
                <span className="truncate">{child.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function Sidebar({
  role,
  dbRole,
  reserveLogoUrl,
  reserveName,
  reserves = [],
  currentReserveId,
  userName,
  userId,
  photoPath,
  activeMode,
  roleLabel,
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { sidebarOpen: persistedSidebarOpen, toggleSidebar } = useUIStore();
  // O valor persistido (localStorage, via zustand/persist) só existe no client —
  // usá-lo direto no primeiro render causa mismatch de hidratação (SSR sempre
  // renderiza o default `true`). Mesmo padrão do mounted-guard em header.tsx
  // para o tema: renderiza o default até montar, só então aplica o persistido.
  const [mounted, setMounted] = useState(false);
  // Achado pré-existente (regra canônica do CLAUDE.md): mesmo falso-positivo
  // documentado em header.tsx — guard de hidratação SSR, dispara 1x só.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); }, []);
  const pinnedOpen = mounted ? persistedSidebarOpen : true;
  const [hovering, setHovering] = useState(false);
  const visuallyOpen = pinnedOpen || hovering;
  const items = navByRole[role];
  const [switching, setSwitching] = useState(false);
  const { isStaff, handleSignOut, handleModeToggle } = useUserMenuActions(dbRole, activeMode);

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
      if (next.has(href)) next.delete(href); else next.add(href);
      return next;
    });
  }

  // SP1: admin_global/auditor têm o modo matriz (visão de tenant, active_reserve_id
  // NULL). Ganham o item "Ver todas as reservas" mesmo com poucas reservas na lista.
  const canGoMatriz = dbRole === "admin_global" || dbRole === "auditor";
  // Chevron colapsável + dropdown só aparece com mais de duas reservas (ou
  // modo matriz disponível) — com 1-2 reservas o nome fica estático, sem
  // fricção extra de um menu pra uma escolha binária.
  const canSwitch = reserves.length > 2 || canGoMatriz;
  const displayName = currentReserveId ? (reserveName ?? "Reserva") : (canGoMatriz ? "Todas as reservas" : (reserveName ?? "Reserva"));

  async function postSwitch(path: string) {
    if (switching) return false;
    setSwitching(true);
    try {
      const res = await fetch(`${BFF_URL}/api/reserves/switch/${path}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrfHeaders() as Record<string, string>),
        },
      });
      if (!res.ok) {
        toast.error("Não foi possível trocar de reserva. Tente novamente.");
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setSwitching(false);
    }
  }

  async function switchReserve(reserveId: string) {
    if (reserveId === currentReserveId) return;
    await postSwitch(reserveId);
  }

  async function switchToMatriz() {
    if (!currentReserveId) return;
    await postSwitch("matriz");
  }

  return (
    <TooltipProvider delay={300}>
      <SidebarProvider pinnedOpen={pinnedOpen} hovering={hovering} setHovering={setHovering}>
        <SidebarBody>
          <div className="flex min-h-16 items-center justify-between border-b p-4">
            <Tooltip>
              <TooltipTrigger
                type="button"
                data-testid="btn-sidebar-toggle"
                aria-label={pinnedOpen ? "Fechar menu lateral" : "Abrir menu lateral"}
                onClick={toggleSidebar}
                // Causa raiz real do achado SDB-04: o botão trocava de classe
                // (mx-auto <-> order-2) conforme visuallyOpen, ou seja, mudava
                // de posição física na tela bem no meio da transição de
                // largura do rail (w-16->w-56) — derrubando a tooltip que
                // estava ancorada nele. Fix: `order-1` fixo (sempre primeiro
                // na linha, nunca depende de o logo/dropdown existir como
                // irmão) mantém o botão no MESMO x na tela nos dois estados,
                // então mesmo que o hover-expand dispare durante o hover no
                // toggle, o botão não se desloca — resolve pra aproximação
                // real de mouse (que entra pela `div` de padding do header
                // antes de tocar o botão, não só pro salto instantâneo do
                // Playwright) e não só pro canal de mouse: stopPropagation
                // abaixo cobre o Tab (SidebarBody também expande no onFocus,
                // ver ui/sidebar.tsx) — o Tab sempre aterrissa direto no
                // elemento focável, sem "passar por" nada, então aqui
                // stopPropagation é 100% confiável.
                onMouseEnter={(e) => e.stopPropagation()}
                onFocus={(e) => e.stopPropagation()}
                className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "order-1 shrink-0")}
              >
                {pinnedOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
              </TooltipTrigger>
              <TooltipContent side="right">
                {pinnedOpen ? "Fechar menu lateral" : "Abrir menu lateral"}
              </TooltipContent>
            </Tooltip>
            {visuallyOpen && (
              <div className="order-2 flex min-w-0 flex-1 items-center gap-2">
                {reserveLogoUrl
                  // eslint-disable-next-line @next/next/no-img-element -- logo é URL assinada do Supabase Storage, domínio arbitrário por reserva
                  ? <img src={reserveLogoUrl} alt="Logo da Reserva" width={32} height={32} className="rounded-md shrink-0 object-contain" />
                  : <Image src="/images/logo.png" alt="Logo" width={32} height={32} className="rounded-md shrink-0" />
                }

                {canSwitch ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      disabled={switching}
                      className="flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-left text-sm font-semibold text-primary outline-none transition-colors hover:bg-primary/10"
                    >
                      <span className="truncate leading-tight">{displayName}</span>
                      <ChevronDown className="size-3.5 shrink-0 opacity-60" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-52">
                      {canGoMatriz && (
                        <DropdownMenuItem
                          onClick={switchToMatriz}
                          className="flex items-center gap-2 font-medium"
                        >
                          <span className="flex-1 truncate">Todas as reservas</span>
                          {!currentReserveId && <Check className="size-3.5 text-primary" />}
                        </DropdownMenuItem>
                      )}
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
                  <span className="truncate text-sm font-semibold leading-tight text-primary">
                    {displayName}
                  </span>
                )}
              </div>
            )}
          </div>

          <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
            {items.map((item) => {
              if (!item.children?.length) {
                return (
                  <SidebarLink
                    key={item.href}
                    link={{ href: item.href, label: item.label, icon: <item.icon size={18} className="shrink-0" /> }}
                    active={isActive(item.href, pathname)}
                  />
                );
              }
              return (
                <NavGroup
                  key={item.href}
                  item={item}
                  pathname={pathname}
                  visuallyOpen={visuallyOpen}
                  isGroupOpen={openGroups.has(item.href)}
                  onToggle={() => toggleGroup(item.href)}
                />
              );
            })}
          </nav>

          <div className="mt-auto border-t p-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                data-testid="sidebar-profile-trigger"
                className={cn(
                  "flex w-full min-w-0 items-center gap-3 rounded-[6px] px-3 py-2 text-left outline-none transition-colors hover:bg-primary/10",
                  !visuallyOpen && "justify-center px-0"
                )}
              >
                <ProfileAvatar
                  profileId={userId}
                  photoPath={photoPath ?? null}
                  name={userName}
                  className="h-8 w-8 shrink-0 overflow-hidden"
                />
                {visuallyOpen && (
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                    {userName}
                  </span>
                )}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="w-52">
                <DropdownMenuItem onClick={() => router.push("/perfil")}>
                  <User size={14} className="mr-2" />
                  Perfil
                </DropdownMenuItem>

                {isStaff && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={handleModeToggle}
                      className={activeMode === "usuario" ? "text-amber-600 dark:text-amber-400" : ""}
                    >
                      <ArrowRightLeft size={14} className="mr-2" />
                      {activeMode === "usuario"
                        ? `Voltar ao modo ${roleLabel ?? dbRole}`
                        : "Modo Usuário"}
                    </DropdownMenuItem>
                  </>
                )}

                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push("/suporte")}>
                  <LifeBuoy size={14} className="mr-2" />
                  Reportar
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleSignOut}
                  className="text-destructive"
                >
                  <LogOut size={14} className="mr-2" />
                  Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </SidebarBody>
      </SidebarProvider>
    </TooltipProvider>
  );
}
