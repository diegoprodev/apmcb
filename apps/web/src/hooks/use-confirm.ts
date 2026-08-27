import { useCallback, useState } from "react";

/**
 * Achado MÉDIO de code review (UX Fases 6-8): o padrão handle-do-confirm
 * usado pra migrar os 5 `window.confirm()` pro `AlertDialog` compartilhado
 * (ver `src/components/ui/alert-dialog.tsx`) foi copiado em 5 arquivos
 * (`_arsenal-client.tsx`, `_biometric-console-client.tsx`,
 * `_criar-armeiro-client.tsx`, `_cadastrar-militar-dialog.tsx`,
 * `_edit-dialog.tsx`) — cada um reimplementando o mesmo par
 * `useState<T | null>(null)` + "abrir"/"cancelar" na mão, com deriva de
 * nomes (`materialToDelete`/`deviceToRevoke`/`showResendConfirm`/
 * `pendingEmailChange`).
 *
 * Extrai só a parte genuinamente idêntica — o estado do "alvo pendente de
 * confirmação" e como abrir/cancelar — SEM tentar unificar quando cada
 * chamador fecha o dialog (isso continua variando de propósito: o "grupo
 * simples" fecha o AlertDialog imediatamente ao confirmar, antes do await;
 * o "grupo com lógica embutida" só fecha no sucesso, mantendo o spinner
 * visível durante a request — ver comentários em cada call site). Essa
 * distinção é uma decisão de UX real, não duplicação — cada call site
 * continua chamando `cancel()` explicitamente no momento certo pra ele.
 *
 * `pending` guarda o próprio alvo (não um boolean) — controla o `open` do
 * AlertDialog via `!!pending` e alimenta a Description da confirmação
 * (ex: "Desativar {pending.nome}?"). Para os 2 casos onde não há um alvo
 * por item (a confirmação é sobre uma AÇÃO, não sobre um dado específico —
 * "Reenviar convite?" em `_criar-armeiro-client.tsx`/
 * `_cadastrar-militar-dialog.tsx`, onde o alvo real já vive em
 * `selectedProfile`), usa-se `useConfirm<true>()` e `request(true)` como
 * sinalizador puro.
 */
export function useConfirm<T>() {
  const [pending, setPending] = useState<T | null>(null);
  const request = useCallback((target: T) => setPending(target), []);
  const cancel = useCallback(() => setPending(null), []);
  return { pending, request, cancel, setPending } as const;
}
