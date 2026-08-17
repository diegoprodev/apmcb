"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      style={{ backgroundColor: "rgba(0,0,0,0.80)" }}
      {...props}
    />
  )
}

// IMPORTANTE ao passar um max-w-* customizado via `className`: use o
// prefixo `sm:` (ex: `sm:max-w-2xl`), nunca a classe sem prefixo (ex:
// `max-w-2xl`). O default abaixo já usa `sm:max-w-sm` — uma classe sem
// prefixo tem especificidade de media query MENOR e perde pro `sm:max-w-sm`
// em qualquer tela ≥640px (tailwind-merge não deduplica classes com
// modificadores diferentes, então as duas ficam no DOM e o CSS do
// breakpoint vence). Achado real: vários dialogs do app ficavam presos em
// 384px de largura em qualquer desktop, cramped, porque usavam max-w-*
// sem o prefixo sm:.
//
// max-h-[calc(100vh-2rem)] + overflow-y-auto (achado real, reclamação de
// produto num monitor de 14"): sem limite de altura, um dialog com muitos
// campos (ex: _registrar-ocorrencia-dialog.tsx) simplesmente crescia além do
// viewport SEM barra de rolagem — a única saída pro usuário era diminuir o
// zoom do navegador pra enxergar o rodapé com os botões. Mesma fórmula
// `calc(100%-2rem)` já usada na largura acima, agora pra altura: nunca
// encosta nas bordas da tela, e o conteúdo rola internamente em vez de
// forçar zoom-out. DialogFooter abaixo fica `sticky bottom-0` propositalmente
// — assim os botões de ação (e o "Cancelar", uma saída sempre alcançável)
// não somem rolando junto com o conteúdo (Lei de Fitts: alvo constante e
// fácil de alcançar).
function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] max-h-[calc(100vh-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl p-4 text-sm shadow-2xl duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
        style={{ backgroundColor: "hsl(var(--card))", color: "hsl(var(--card-foreground))" }}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "sticky bottom-0 -mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t p-4 sm:flex-row sm:justify-end",
        className
      )}
      style={{ backgroundColor: "hsl(var(--card))" }}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
