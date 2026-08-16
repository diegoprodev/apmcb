"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// Barra de progresso no topo, reagindo a mudança de rota — feedback visual
// para o delay real de navegação (round-trips de Server Components) sem
// nunca envolver NENHUM Server Component em Suspense. Ver
// docs do incidente 2026-07-17: um loading.tsx (Suspense em torno da árvore
// de (dashboard)/layout.tsx) converteu um redirect() de HTTP 307 real para
// client-side, quebrando o guard fail-closed de session-mismatch — por isso
// este componente nunca ganha children Server Component nem substitui
// nenhuma página. `<Suspense>` aqui embaixo só existe pra satisfazer o
// requisito do Next.js de useSearchParams() e é local a este componente
// 100% client — não afeta nenhum redirect() de página em nenhum lugar.
const MAX_VISIBLE_MS = 6_000; // fallback: nunca fica presa pra sempre se a navegação nunca "completar" (ex: só searchParams mudando via replace)

function ProgressBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function clearTimers() {
      if (tickRef.current) clearInterval(tickRef.current);
      if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
      tickRef.current = null;
      maxTimerRef.current = null;
    }

    function start() {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      clearTimers();
      setVisible(true);
      setProgress(12);
      tickRef.current = setInterval(() => {
        setProgress((p) => (p >= 88 ? p : p + Math.max(1, (88 - p) * 0.12)));
      }, 180);
      maxTimerRef.current = setTimeout(() => finish(), MAX_VISIBLE_MS);
    }

    function finish() {
      clearTimers();
      setProgress(100);
      hideTimerRef.current = setTimeout(() => {
        setVisible(false);
        setProgress(0);
      }, 200);
    }

    // Clique em link interno dispara a barra ANTES do RSC payload chegar —
    // esperar só pela mudança de pathname/searchParams deixaria a barra
    // visivelmente atrasada em relação ao clique do usuário.
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest("a");
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      start();
    }

    document.addEventListener("click", onClick, { capture: true });
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      clearTimers();
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  const routeKey = `${pathname}?${searchParams?.toString() ?? ""}`;
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    // Rota efetivamente mudou — navegação concluída, completa a barra.
    setProgress(100);
    const t = setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 200);
    return () => clearTimeout(t);
  }, [routeKey]);

  if (!visible) return null;

  return (
    <div
      aria-hidden="true"
      className="fixed inset-x-0 top-0 z-[2147483000] h-[3px] pointer-events-none"
    >
      <div
        className="h-full bg-primary shadow-[0_0_8px_var(--color-primary)] transition-[width] duration-200 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

export function NavigationProgress() {
  return <ProgressBar />;
}
