"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

// Deep-link "?highlight=<id>" vindo do sino de notificações (ver
// resolveNotificationRoute em components/layout/notification-bell.tsx): antes
// desta mudança, clicar numa notificação não navegava a lugar nenhum (só
// marcava como lida) — achado real reportado pelo usuário para
// "armament_requested" ("Nova Solicitação de Armamento"), mas a causa era a
// funcionalidade inteira de navegação nunca ter sido implementada, para
// nenhum dos 16 tipos de notificação. Depois de navegar corretamente, ainda
// falta abrir/destacar o item específico numa lista que pode ter dezenas de
// registros — sem isso, "abrir a notificação" só leva pra lista genérica e o
// usuário tem que procurar manualmente (fricção que o CLAUDE.md pede pra
// eliminar: ação principal em ≤ 2 cliques).
const HIGHLIGHT_DURATION_MS = 4000;

// Classe Tailwind reutilizada por toda tela que consome este hook, pra manter
// o mesmo tratamento visual de "item destacado por deep-link" em todo o app
// (SSOT — evitar cada tela inventar seu próprio anel/cor).
export const HIGHLIGHT_RING_CLASS = "ring-2 ring-amber-500 ring-offset-2 ring-offset-background";

export function useHighlightItem() {
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("highlight");
  // `flashId` controla só a duração visual do destaque (algumas telas fazem
  // polling/router.refresh() periódico — sem separar isso de `highlightId`,
  // o anel voltaria a cada re-render em vez de desaparecer depois de
  // HIGHLIGHT_DURATION_MS).
  const [flashId, setFlashId] = useState<string | null>(highlightId);
  // Evita chamar scrollIntoView em todo re-render enquanto o ref permanece
  // montado (ex: troca de tab que não desmonta o elemento) — só a primeira
  // vez que o id-alvo aparece no DOM.
  const scrolledIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!highlightId) return;
    setFlashId(highlightId);
    scrolledIdRef.current = null;
    const timer = setTimeout(() => setFlashId(null), HIGHLIGHT_DURATION_MS);
    return () => clearTimeout(timer);
  }, [highlightId]);

  // Ref-callback: anexar em `ref={highlightRef(item.id)}` no elemento de cada
  // linha/card de lista. Quando o elemento com o id-alvo é montado (após
  // expandir accordion/trocar tab/carregar dados), rola até ele.
  const highlightRef = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (!el || id !== highlightId || scrolledIdRef.current === id) return;
      scrolledIdRef.current = id;
      // rAF: espera o layout (accordion recém-aberto, tab recém-trocada)
      // assentar antes de medir a posição — sem isso o scroll mede contra o
      // layout anterior e erra o alvo.
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    },
    [highlightId]
  );

  const isHighlighted = useCallback((id: string) => flashId === id, [flashId]);

  return { highlightId, highlightRef, isHighlighted };
}
