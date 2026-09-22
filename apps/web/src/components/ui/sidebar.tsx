"use client";

import Link, { type LinkProps } from "next/link";
import { createContext, useContext, useRef, type ReactNode } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";

export interface SidebarLinkData {
  label: string;
  href: string;
  icon: ReactNode;
}

interface SidebarContextValue {
  /** Estado fixado pelo usuário (persistido) — controla o texto/ícone do toggle. */
  pinnedOpen: boolean;
  /** Estado visual efetivo (pinnedOpen OU hover) — controla largura/labels. */
  visuallyOpen: boolean;
  setHovering: (hovering: boolean) => void;
}

const SidebarContext = createContext<SidebarContextValue | undefined>(undefined);

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within SidebarProvider");
  return ctx;
}

const WIDTH_OPEN = 224; // w-56
const WIDTH_CLOSED = 64; // w-16

export function SidebarProvider({
  children,
  pinnedOpen,
  hovering,
  setHovering,
}: {
  children: ReactNode;
  pinnedOpen: boolean;
  hovering: boolean;
  setHovering: (hovering: boolean) => void;
}) {
  return (
    <SidebarContext.Provider
      value={{ pinnedOpen, visuallyOpen: pinnedOpen || hovering, setHovering }}
    >
      {children}
    </SidebarContext.Provider>
  );
}

export function SidebarBody({
  className,
  children,
  ...props
}: HTMLMotionProps<"aside">) {
  const { visuallyOpen, setHovering } = useSidebar();
  // Achado real (2026-09-22): dropdowns filhos (troca de reserva, menu de
  // perfil) são renderizados via portal fora da árvore DOM deste <aside> —
  // necessário por causa do overflow-hidden usado na animação de largura.
  // Mover o mouse do trigger pro popup já aberto disparava mouseleave AQUI
  // antes do cursor "entrar" no popup portalizado, colapsando o menu no meio
  // do clique (corrompia o 1º clique; só o 2º, com layout já estável,
  // funcionava). Tentativa anterior (manter aberto enquanto QUALQUER
  // dropdown filho estivesse logicamente aberto) causou regressão pior: se o
  // usuário abre um dropdown e move o mouse embora sem clicar em nada (sem
  // outside-click, sem Escape), o dropdown nunca dispara onOpenChange(false)
  // — o menu ficava travado aberto indefinidamente (achado via E2E:
  // apmcb.spec.ts "sidebar collapses and expands via toggle"). Debounce
  // simples é mais robusto: dá tempo do cursor alcançar o popup (mesmo fora
  // da árvore) sem depender do estado do dropdown — cancelado por qualquer
  // mouseenter/focus subsequente, real ou do próprio popup se ele também
  // disparar foco.
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function cancelLeave() {
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
  }
  function scheduleLeave() {
    cancelLeave();
    leaveTimer.current = setTimeout(() => setHovering(false), 200);
  }
  return (
    <motion.aside
      onMouseEnter={() => { cancelLeave(); setHovering(true); }}
      onMouseLeave={scheduleLeave}
      // Sem isso, tab pelo rail colapsado nunca revela os rótulos — só o
      // mouse expandia. onFocus/onBlur do React usam focusin/focusout por
      // baixo, então capturam foco de qualquer link/botão filho.
      onFocus={() => { cancelLeave(); setHovering(true); }}
      onBlur={scheduleLeave}
      animate={{ width: visuallyOpen ? WIDTH_OPEN : WIDTH_CLOSED }}
      transition={{ duration: 0.25, ease: "easeInOut" }}
      className={cn(
        "hidden md:flex md:flex-col border-r bg-card shrink-0 overflow-hidden",
        visuallyOpen ? "w-56" : "w-16",
        className
      )}
      style={{ boxShadow: "1px 0 6px rgba(0,0,0,0.06)" }}
      {...props}
    >
      {children}
    </motion.aside>
  );
}

export function SidebarLink({
  link,
  active,
  className,
  ...props
}: {
  link: SidebarLinkData;
  active?: boolean;
  className?: string;
} & Omit<LinkProps, "href">) {
  const { visuallyOpen } = useSidebar();
  return (
    <Link
      href={link.href}
      className={cn(
        "group/sidebar flex items-center gap-3 rounded-[6px] px-3 py-2 text-[13px] transition-colors",
        "hover:bg-primary/10 hover:text-primary",
        active ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground",
        !visuallyOpen && "justify-center",
        className
      )}
      {...props}
    >
      <span className="shrink-0 [&>svg]:size-[18px]">{link.icon}</span>
      {visuallyOpen && (
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.15, delay: 0.05 }}
          className="truncate whitespace-nowrap"
        >
          {link.label}
        </motion.span>
      )}
    </Link>
  );
}
