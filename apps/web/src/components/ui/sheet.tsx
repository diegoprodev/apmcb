"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

interface SheetContextValue {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Set by Sheet from its own `suppressRestoreRef` prop, if given — see
   * Sheet's own prop doc for what this is for. Read (and reset) once by
   * SheetContent's restore effect on close. */
  suppressRestoreRef: React.RefObject<boolean>
}

const SheetContext = React.createContext<SheetContextValue>({
  open: false,
  onOpenChange: () => {},
  suppressRestoreRef: { current: false },
})

// Selector + helper shared by the focus trap and the initial-focus logic
// below — same rough allowlist Radix/base-ui use under the hood, good enough
// for a hand-rolled trap: real interactive elements, minus anything disabled
// or explicitly pulled out of tab order (tabindex="-1").
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",")

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    // offsetParent === null excludes display:none / not-yet-rendered elements
    // (loading states, collapsed sections) — same heuristic used widely for this.
    .filter((el) => el.offsetParent !== null)
}

function Sheet({
  open = false,
  onOpenChange,
  suppressRestoreRef,
  children,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Optional escape hatch, created by the caller (`useRef(false)`) and set
   * to `true` right before calling `onOpenChange(false)` — for the case
   * where the caller knows the element that triggered this sheet is about
   * to be removed by something they're doing right after closing (e.g.
   * `router.refresh()` dropping the row this trigger belongs to from a
   * list). Restoring focus to a node that disappears moments later isn't
   * wrong exactly (the browser falls back to `<body>` on its own when the
   * focused node is removed), but it's a pointless flash instead of an
   * intentional, predictable outcome. Consumed once per close, reset
   * automatically — no need to set it back to `false` yourself. Lives with
   * the caller (not created internally by Sheet) because the trigger and
   * the "is it about to be removed" knowledge both belong to the caller,
   * not to Sheet itself. */
  suppressRestoreRef?: React.RefObject<boolean>
  children?: React.ReactNode
}) {
  const internalRef = React.useRef(false)
  const value = React.useMemo(
    () => ({
      open,
      onOpenChange: onOpenChange ?? (() => {}),
      suppressRestoreRef: suppressRestoreRef ?? internalRef,
    }),
    [open, onOpenChange, suppressRestoreRef]
  )

  return (
    <SheetContext.Provider value={value}>
      {children}
    </SheetContext.Provider>
  )
}

function SheetTrigger({ children, asChild, ...props }: React.ComponentProps<"button"> & { asChild?: boolean }) {
  const { onOpenChange } = React.useContext(SheetContext)
  const handleClick = () => onOpenChange(true)

  // asChild ignorado antes (prop desestruturada e descartada) fazia todo
  // caller sempre ganhar um <button> extra envolvendo o filho — achado real
  // (hydration mismatch ao vivo, "In HTML, <button> cannot be a descendant
  // of <button>") quando o filho já é um <Button>/<button>, como em
  // solicitar-armamento-sheet.tsx. Clona o filho e mescla onClick em vez de
  // envolver, igual ao padrão asChild do Radix.
  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{ onClick?: (e: React.MouseEvent) => void }>
    return React.cloneElement(child, {
      ...props,
      onClick: (e: React.MouseEvent) => {
        child.props.onClick?.(e)
        handleClick()
      },
    })
  }

  return (
    <button onClick={handleClick} {...props}>
      {children}
    </button>
  )
}

function SheetClose({ children, ...props }: React.ComponentProps<"button">) {
  const { onOpenChange } = React.useContext(SheetContext)
  return (
    <button onClick={() => onOpenChange(false)} {...props}>
      {children}
    </button>
  )
}

function SheetPortal({ children }: { children?: React.ReactNode }) {
  // Achado de code review: inicializar com `false` + useEffect fazia
  // SheetContent inteiro (Sheet fecha -> `if (!open) return null` -> este
  // componente desmonta -> reabre -> remonta do zero) sempre passar por um
  // "double commit": 1ª renderização com `mounted=false` (children nunca
  // chegam a virar DOM real, createPortal não roda), só na 2ª (depois do
  // efeito rodar) o painel de fato existe. O useEffect de foco inicial de
  // SheetContent (que corre no MESMO commit que este, componente irmão) via
  // requestAnimationFrame pra "dar tempo" desse 2º commit acontecer antes —
  // mas os dois são mecanismos de scheduling independentes sem ordem
  // garantida entre si, e sob carga real (confirmado ao vivo via Playwright,
  // não em teoria) o rAF podia disparar com panelRef.current ainda null,
  // abortando o foco em silêncio e deixando o focus trap sem nada dentro do
  // painel pra ancorar. Inicializar `mounted` já como `true` quando há
  // `document` (sempre verdade aqui — Sheet só roda em Client Components)
  // elimina o commit intermediário: createPortal roda na PRIMEIRA
  // renderização, sem depender de nenhum efeito rodar antes.
  // Achado de re-revisão (nota corrigida após leitura mais cuidadosa da
  // semântica de hidratação do React): este efeito NÃO "recupera" um SSR
  // hipotético com `open=true` — o inicializador do useState roda de novo,
  // do zero, na primeira passada client, então `mounted` já nasce `true`
  // assim que existe `document`, com ou sem este efeito. Um Sheet futuro
  // que abrisse com `open=true` já no SSR teria um problema DIFERENTE
  // (mismatch de hidratação: o servidor não renderiza nada, o cliente tenta
  // criar o portal), que este efeito não trata. Mantido mesmo assim como
  // defensivo/redundante — mesma categoria do guard `if (!panel) return` no
  // rAF logo abaixo — sem custo real (no caminho comum, `mounted` já é
  // `true` e o efeito é um no-op).
  const [mounted, setMounted] = React.useState(() => typeof document !== "undefined")
  React.useEffect(() => {
    if (!mounted) setMounted(true)
  }, [mounted])
  if (!mounted) return null
  return createPortal(children, document.body)
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: React.ComponentProps<"div"> & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
}) {
  const { open, onOpenChange, suppressRestoreRef } = React.useContext(SheetContext)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const previouslyFocusedRef = React.useRef<HTMLElement | null>(null)

  React.useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, onOpenChange])

  // Initial focus (on open) + focus restoration (on close). Captures
  // whatever had focus right before opening — the trigger, in the common
  // case — and hands it back when the sheet closes, regardless of how it
  // closed (Escape, overlay click, close button, or a caller-driven
  // onOpenChange in controlled mode). The rAF just waits one frame past
  // React's own commit (SheetPortal now mounts synchronously — see its
  // comment above — so panelRef is already attached by the time this
  // effect runs; the rAF is only here so focus lands after layout/paint,
  // not to wait on a second commit that no longer happens).
  //
  // Real bug found and fixed here (confirmed live via Playwright, not just
  // reasoning): SheetPortal used to defer its actual `createPortal(...)`
  // call by one extra render (useState(false) + useEffect), so on the
  // FIRST commit after opening, panelRef.current was still null — this rAF
  // could fire before that second commit landed, silently no-op'ing (the
  // `if (!panel) return` below) and leaving focus outside the panel, which
  // in turn meant the Tab-trap effect below never found `document.activeElement`
  // inside the panel and never engaged. Confirmed with a temporary console.log
  // in the rAF callback: `panel: false` on the very run this test caught.
  React.useEffect(() => {
    if (!open) return
    previouslyFocusedRef.current = (document.activeElement as HTMLElement) ?? null

    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current
      if (!panel) return
      const [first] = getFocusableElements(panel)
      ;(first ?? panel).focus()
    })

    return () => {
      cancelAnimationFrame(raf)
      // suppressFocusRestore() (see SheetContext) — set by a caller who
      // knows the trigger is about to be removed by something they're
      // about to do (e.g. router.refresh() after the row this trigger
      // belongs to is dropped from a list). Consumed once, not sticky.
      if (suppressRestoreRef.current) {
        suppressRestoreRef.current = false
        return
      }
      const toRestore = previouslyFocusedRef.current
      if (toRestore && document.contains(toRestore)) {
        toRestore.focus()
      }
    }
  }, [open, suppressRestoreRef])

  // Focus trap: only intercepts Tab at the panel's own boundaries (first/last
  // focusable element), so normal tab order between elements inside the panel
  // is untouched — Tab off the last element (or Shift+Tab off the first) loops
  // back inside instead of escaping to whatever is behind the overlay.
  React.useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return
      const panel = panelRef.current
      if (!panel) return

      const focusable = getFocusableElements(panel)
      if (focusable.length === 0) {
        event.preventDefault()
        panel.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      if (event.shiftKey) {
        if (active === first) {
          event.preventDefault()
          last.focus()
        }
      } else {
        if (active === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open])

  const sideClasses = {
    right: "inset-y-0 right-0 h-full w-3/4 sm:max-w-sm border-l",
    left:  "inset-y-0 left-0 h-full w-3/4 sm:max-w-sm border-r",
    top:   "inset-x-0 top-0 h-auto border-b",
    bottom:"inset-x-0 bottom-0 h-auto border-t",
  }

  if (!open) return null

  return (
    <SheetPortal>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-50"
        style={{ backgroundColor: "rgba(0,0,0,0.75)" }}
        onClick={() => onOpenChange(false)}
      />
      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed z-50 flex flex-col gap-4 shadow-2xl",
          sideClasses[side],
          className
        )}
        style={{
          backgroundColor: "hsl(var(--card))",
          color: "hsl(var(--card-foreground))",
          borderColor: "hsl(var(--border))",
        }}
        onClick={(e) => e.stopPropagation()}
        {...props}
      >
        {children}
        {showCloseButton && (
          <Button
            variant="ghost"
            className="absolute top-3 right-3"
            size="icon-sm"
            onClick={() => onOpenChange(false)}
          >
            <XIcon />
            <span className="sr-only">Fechar</span>
          </Button>
        )}
      </div>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-0.5 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="sheet-title"
      className={cn("text-base font-medium", className)}
      {...props}
    />
  )
}

function SheetDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
