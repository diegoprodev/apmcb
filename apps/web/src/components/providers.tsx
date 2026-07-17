"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ThemeProvider } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { Toaster } from "@/components/ui/sonner";
import { createClient } from "@/lib/supabase/client";

// Rotas de fluxo de auth — não precisam do redirect automático de
// SIGNED_OUT (já tratam suas próprias transições). Usado só pelo
// AuthListener.
function isAuthFlowRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/nexus")
  );
}

// Mesma allowlist de `middleware.ts` (DASHBOARD_PATH_PREFIXES) — as ÚNICAS
// rotas que renderizam dado de sessão por-usuário. Usado pelo
// ResumeMaskOverlay abaixo: default seguro é NÃO mascarar (qualquer rota
// fora desta lista, incluindo públicas hoje inexistentes amanhã, nunca
// fica presa mascarada). Achado de code review: usar uma allowlist de
// rotas "públicas" (o inverso) travava permanentemente `/v/[document_id]`
// (verificação pública de documento via QR code, sem sessão) — `getUser()`
// resolve `{user: null}` sem erro para visitante anônimo, então o overlay
// nunca desmascarava.
const DASHBOARD_PATH_PREFIXES = ["/admin", "/reserva", "/efetivo", "/perfil", "/suporte"];
function isDashboardRoute(pathname: string): boolean {
  return DASHBOARD_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

// supabase.auth.getUser() não tem timeout embutido (depende só do timeout
// de rede do browser/SO) — em campo (celular↔wifi, sinal instável), a
// promise pode nunca resolver, travando revalidatingRef.current=true pra
// sempre e descartando todo evento de visibilidade seguinte sem nova
// tentativa. Timeout explícito garante que o guard sempre libera.
const REVALIDATE_TIMEOUT_MS = 6_000;

// Redirect to /login whenever the Supabase session is invalidated (expired or
// revoked refresh token → 400 on /auth/v1/token → SIGNED_OUT event). Without
// this, the app silently retries with no valid token, causing console errors
// from Realtime WebSocket reconnection attempts.
function AuthListener() {
  const pathname = usePathname();

  useEffect(() => {
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" && !isAuthFlowRoute(pathname)) {
        // Full page load — evita que o Router Cache reaproveite payload RSC
        // desta sessão para o próximo usuário que logar nesta aba.
        window.location.href = "/login";
      }
    });
    return () => subscription.unsubscribe();
  }, [pathname]);

  return null;
}

// Mascara o conteúdo da tela ao app ir para background e só revela depois
// de revalidar a sessão — mitigação best-effort de exposição de dado de
// sessão suspensa, achado real desta sessão (relato do usuário: painel do
// usuário anterior visível por um instante ao reabrir o PWA a partir de
// background). Ver docs/superpowers/specs/
// 2026-07-17-pwa-native-boot-experience-design.md seção 3.5.
//
// Honesto sobre o limite real: o iOS congela o snapshot que será
// restaurado no resume ao entrar em background, e páginas ocultas têm
// rendering despriorizado, sem garantia de repaint antes desse
// congelamento (WebKit bug 202399 documenta `visibilitychange` como
// não-confiável em standalone web apps no iOS). Por isso: (1) o overlay
// fica SEMPRE montado na árvore (nunca criado reativamente dentro do
// handler), só alternando visibilidade via classe — o React não precisa
// criar nós DOM novos na hora do evento; (2) múltiplos gatilhos
// redundantes (visibilitychange, pagehide, blur) — nenhum garante 100%,
// juntos reduzem a janela; (3) validado em hardware real como critério de
// aceite de segurança (não uma garantia "resolvida por design").
function ResumeMaskOverlay() {
  const pathname = usePathname();
  const dashboardRoute = isDashboardRoute(pathname);
  // Nasce mascarado — cobre também o caso do processo ter sido encerrado
  // pelo SO em vez de suspenso: nesse caso o boot é um load fresco (SSR
  // já autorizado), mas nascer mascarado e revelar só após confirmar
  // sessão válida não tem custo perceptível (revalidação é rápida) e
  // remove a dependência de ter capturado corretamente o evento de saída.
  const [masked, setMasked] = useState(true);
  const revalidatingRef = useRef(false);

  useEffect(() => {
    if (!dashboardRoute) {
      setMasked(false);
      return;
    }

    function hide() {
      setMasked(true);
    }

    async function revalidateAndReveal() {
      if (revalidatingRef.current) return;
      revalidatingRef.current = true;
      try {
        const supabase = createClient();
        // getUser() do SDK não tem timeout embutido — Promise.race garante
        // que o guard sempre libera mesmo se a rede travar (achado de code
        // review), em vez de depender só do catch de uma promise que pode
        // nunca resolver nem rejeitar.
        const { data: { user } } = await Promise.race([
          supabase.auth.getUser(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("getUser timeout")), REVALIDATE_TIMEOUT_MS)
          ),
        ]);
        // user null: AuthListener cuida do redirect via SIGNED_OUT; overlay
        // continua mascarando até a navegação — nunca revela sem confirmação.
        if (user) setMasked(false);
      } catch {
        // falha de rede/timeout — mantém mascarado (best-effort, fail-closed).
      } finally {
        revalidatingRef.current = false;
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "hidden") hide();
      else void revalidateAndReveal();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", hide);
    window.addEventListener("blur", hide);

    void revalidateAndReveal();

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("blur", hide);
    };
  }, [dashboardRoute]);

  return (
    <div
      aria-hidden={!masked}
      // z-index máximo (max int32) — não confiar em nenhum valor "grande o
      // suficiente": o Toaster (Sonner) usa 999999999 internamente, maior
      // que qualquer z-[N] arbitrário do Tailwind (achado de code review).
      className={`fixed inset-0 flex items-center justify-center bg-[#F5F5F7] transition-opacity duration-150 ${
        masked ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
      style={{ zIndex: 2147483647 }}
    >
      <Image src="/images/pwa/pwa-192x192.png" alt="" width={96} height={96} />
    </div>
  );
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
        <ResumeMaskOverlay />
        {children}
        <Toaster richColors closeButton />
      </ThemeProvider>
      {process.env.NODE_ENV === "development" && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
