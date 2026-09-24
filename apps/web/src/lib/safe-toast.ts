import { toast } from "sonner";
import { userSafeMessage } from "@/lib/api-error";

type ToastFn = (message: unknown, options?: Record<string, unknown>) => unknown;

function sanitize(value: unknown): unknown {
  return typeof value === "string" ? userSafeMessage(value) : value;
}

let installed = false;

/**
 * Regra de produto (não negociável): nenhum toast de erro/aviso/informação
 * expõe código interno, erro de banco ou texto técnico — só mensagem genérica
 * e amigável. Vale para TODOS os toasts (centenas de call sites) porque o
 * filtro fica no próprio `toast` compartilhado; o detalhe técnico continua
 * indo pro console (console.error) nos call sites. Toasts de sucesso não são
 * tocados. Idempotente.
 */
export function installSafeToast(): void {
  if (installed) return;
  installed = true;

  const target = toast as unknown as Record<string, ToastFn>;
  for (const key of ["error", "warning", "info", "message"]) {
    const original = target[key];
    if (typeof original !== "function") continue;
    target[key] = (message, options) =>
      original.call(
        toast,
        sanitize(message),
        options && "description" in options ? { ...options, description: sanitize(options.description) } : options,
      );
  }
}
