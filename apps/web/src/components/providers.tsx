"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ThemeProvider } from "next-themes";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Toaster } from "@/components/ui/sonner";
import { createClient } from "@/lib/supabase/client";

// Redirect to /login whenever the Supabase session is invalidated (expired or
// revoked refresh token → 400 on /auth/v1/token → SIGNED_OUT event). Without
// this, the app silently retries with no valid token, causing console errors
// from Realtime WebSocket reconnection attempts.
function AuthListener() {
  const pathname = usePathname();

  useEffect(() => {
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (
        event === "SIGNED_OUT" &&
        !pathname.startsWith("/login") &&
        !pathname.startsWith("/auth") &&
        !pathname.startsWith("/nexus")
      ) {
        // Full page load — evita que o Router Cache reaproveite payload RSC
        // desta sessão para o próximo usuário que logar nesta aba.
        window.location.href = "/login";
      }
    });
    return () => subscription.unsubscribe();
  }, [pathname]);

  return null;
}

// Força uma checagem ativa de atualização do service worker a cada cold
// start do app (root layout monta uma vez por load completo, não por
// navegação client-side dentro do app). @serwist/next registra o SW
// automaticamente, mas a checagem de "há uma versão nova?" é passiva por
// padrão (o browser decide quando checar) — iOS em modo PWA (ícone na tela
// inicial, sem aba/reload manual) é conhecidamente preguiçoso nisso, podendo
// ficar semanas rodando um SW desatualizado. skipWaiting+clientsClaim
// (sw.ts) já garantem ativação imediata QUANDO uma checagem acontece — isto
// aqui aumenta a frequência real dessa checagem. Não é garantia de reparo
// para um device que já esteja preso sem completar nenhum fetch de rede
// fresco — nesse caso o único fix determinístico é remover e reinstalar o
// ícone do PWA (novo registro de SW do zero).
function ServiceWorkerUpdater() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.getRegistration()
      .then((reg) => reg?.update())
      .catch(() => {});
  }, []);

  return null;
}

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "https://api.apmcb.pmpb.online";

// TEMPORÁRIO (2026-07-17) — diagnóstico do incidente de logout/tela-preta no
// PWA iOS. Sem acesso a device físico/Mac pra Web Inspector remoto, esta é a
// única forma de capturar exceções JS não tratadas que travam a UI ANTES de
// qualquer fetch de rede disparar (por isso invisível nos logs do servidor).
// Reporta pro mesmo POST /api/public/diag-log (BFF) usado pelo guard
// session_mismatch em (dashboard)/layout.tsx. REMOVER junto com o resto da
// instrumentação temporária após o incidente ser resolvido.
function ClientErrorReporter() {
  useEffect(() => {
    function report(payload: Record<string, unknown>) {
      fetch(`${BFF_URL}/api/public/diag-log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          url: window.location.href,
          userAgent: navigator.userAgent,
          standalone: (navigator as { standalone?: boolean }).standalone ?? null,
          at: new Date().toISOString(),
        }),
        keepalive: true,
      }).catch(() => {});
    }

    function onError(event: ErrorEvent) {
      report({
        event: "client-js-error",
        message: event.message,
        stack: event.error?.stack?.slice(0, 2000) ?? null,
        filename: event.filename,
        lineno: event.lineno,
      });
    }
    function onRejection(event: PromiseRejectionEvent) {
      const reason = event.reason;
      report({
        event: "client-unhandled-rejection",
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack?.slice(0, 2000) ?? null : null,
      });
    }

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    // Confirma que o próprio reporter carregou e executou — se nunca vir
    // esse evento no log, o problema é anterior à hidratação do React.
    report({ event: "client-boot" });

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <AuthListener />
        <ServiceWorkerUpdater />
        <ClientErrorReporter />
        {children}
        <Toaster richColors closeButton />
      </ThemeProvider>
      {process.env.NODE_ENV === "development" && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
