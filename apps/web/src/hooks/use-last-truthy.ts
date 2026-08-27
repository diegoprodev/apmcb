import { useRef } from "react";

/**
 * Achado BAIXO de code review (UX Fases 6-8): a `Description` de um
 * `AlertDialog` de confirmação costuma ser condicional no próprio dado que
 * disparou a confirmação (`{materialToDelete && <>...</>}`) — mas fechar o
 * dialog (confirmar ou cancelar) limpa esse dado (`setMaterialToDelete(null)`)
 * ANTES da animação de saída (`data-closed:animate-out`) terminar. O
 * `AlertDialogPrimitive.Popup` continua montado durante o fade-out, então o
 * usuário via o texto sumir (ficar em branco) por ~100ms antes do dialog
 * inteiro desaparecer — um flash visual, não um bug funcional.
 *
 * Guarda o último valor truthy visto via ref (mutação em render, não em
 * efeito — mesmo padrão de memoização "derived state" oficialmente aceito
 * pelo React: idempotente a cada render, sem side effect assíncrono) e o
 * devolve mesmo depois que `value` já virou null — o texto continua visível
 * durante o fade-out em vez de piscar vazio.
 */
export function useLastTruthy<T>(value: T | null | undefined): T | null {
  const ref = useRef<T | null>(null);
  if (value) ref.current = value;
  return ref.current;
}
