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

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "https://api.apmcb.pmpb.online";

// Timeout explícito da revalidação — sem isso, a promise podia nunca
// resolver/rejeitar em rede instável, travando revalidatingRef.current=true
// pra sempre e descartando todo evento de visibilidade seguinte sem nova
// tentativa.
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
// BUG CRÍTICO DE PRODUÇÃO (2026-07-17, corrigido): a 1ª versão revalidava
// via `supabase.auth.getUser()` (SDK do browser) — quebrado nesta app
// porque `apps/web/src/lib/supabase/server.ts` faz upgrade dos cookies
// sb-* para httpOnly logo após o login (`/api/auth/upgrade-session`,
// "SSE via BFF proxy elimina a necessidade de cookies sb-* legíveis por
// JS"). Depois desse upgrade, o cliente Supabase do BROWSER não consegue
// mais ler o cookie de sessão (httpOnly = invisível a `document.cookie`),
// então `getUser()` client-side SEMPRE resolvia `{user: null}` — o overlay
// nunca desmascarava para NINGUÉM, não só em rede instável (confirmado no
// próprio CI: `E2E Smoke` falhou no mesmo commit, Chrome desktop, rede
// confiável do GitHub Actions — não era timing). Fix: revalidar via
// `fetch({BFF_URL}/api/auth/me, {credentials: "include"})`, o mesmo padrão
// já usado e comprovado em `hooks/use-role-guard.ts` e
// `admin/estrutura/page.tsx` — cookies httpOnly SÃO enviados
// automaticamente pelo browser em requests com `credentials: "include"`,
// só não são legíveis via JS (é exatamente essa a garantia de segurança
// do httpOnly, e é por isso que ler via SDK local não funciona mais).
//
// Honesto sobre o limite real do mascaramento em si: o iOS congela o
// snapshot que será restaurado no resume ao entrar em background, e
// páginas ocultas têm rendering despriorizado, sem garantia de repaint
// antes desse congelamento (WebKit bug 202399 documenta `visibilitychange`
// como não-confiável em standalone web apps no iOS). Por isso: (1) o
// overlay fica SEMPRE montado na árvore, só alternando visibilidade via
// classe; (2) múltiplos gatilhos redundantes (visibilitychange, pagehide,
// blur) — nenhum garante 100%, juntos reduzem a janela; (3) validado em
// hardware real como critério de aceite de segurança (não uma garantia
// "resolvida por design").
function ResumeMaskOverlay() {
  const pathname = usePathname();
  const dashboardRoute = isDashboardRoute(pathname);
  // Nasce mascarado SÓ em rota de dashboard — cobre o caso do processo ter
  // sido encerrado pelo SO em vez de suspenso: nesse caso o boot é um load
  // fresco (SSR já autorizado), mas nascer mascarado e revelar só após
  // confirmar sessão válida não tem custo perceptível (revalidação é
  // rápida) e remove a dependência de ter capturado corretamente o evento
  // de saída. `pathname` já é conhecido de forma síncrona em SSR e no
  // 1º render client (mesmo valor dos dois lados, sem risco de mismatch de
  // hidratação) — computar aqui em vez de sempre `true` evita mascarar
  // TODA rota (inclusive /login) por um ciclo de render até o useEffect
  // abaixo corrigir. Esse gap era exatamente o FOUC branco relatado em
  // produção (2026-07-18): overlay cinza-claro cobria a tela inteira no
  // primeiro paint de /login antes do efeito desmascarar. Garantia é só de
  // MOUNT INICIAL, não de toda re-entrada subsequente na rota — reentradas
  // via navegação client-side são cobertas pelo `setMasked(true)` explícito
  // no efeito abaixo, não por este valor inicial.
  const [masked, setMasked] = useState(dashboardRoute);
  const revalidatingRef = useRef(false);

  useEffect(() => {
    if (!dashboardRoute) {
      setMasked(false);
      return;
    }

    // Remascara explicitamente ao (re)entrar numa rota de dashboard — cobre
    // navegação client-side (sem remount do componente, ex: redirect() a
    // partir de not-found.tsx) de volta para o dashboard. Sem isso, `masked`
    // herdava o valor `false` de antes de sair da rota, deixando o dashboard
    // de destino visível sem overlay até `revalidateAndReveal()` (abaixo)
    // resolver de forma assíncrona — achado de code review de segurança.
    setMasked(true);

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function hide() {
      setMasked(true);
    }

    // Retry com backoff exponencial (2s/4s/8s/15s/15s, ~5 tentativas) pra
    // falha/timeout de rede OU erro transitório de servidor — sem isso, o
    // único gatilho de nova tentativa seria `visibilitychange`, que nunca
    // dispara com o app parado em foreground (exatamente o estado em que
    // um usuário preso ficaria olhando).
    function scheduleRetry(attempt: number) {
      if (!cancelled && attempt < 5) {
        const delay = Math.min(2_000 * 2 ** attempt, 15_000);
        retryTimer = setTimeout(() => { void revalidateAndReveal(attempt + 1); }, delay);
      }
    }

    async function revalidateAndReveal(attempt = 0) {
      if (revalidatingRef.current) return;
      revalidatingRef.current = true;
      try {
        const res = await fetch(`${BFF_URL}/api/auth/me`, {
          credentials: "include",
          cache: "no-store",
          signal: AbortSignal.timeout(REVALIDATE_TIMEOUT_MS),
        });
        if (res.ok) {
          setMasked(false);
          return;
        }
        if (res.status === 401 || res.status === 403) {
          // Sessão realmente inválida (BFF validou o cookie httpOnly do
          // lado do servidor e recusou) — RoleWatcher/AuthListener cuidam
          // do redirect; overlay continua mascarando, não é caso de retry.
          return;
        }
        // Qualquer outro status (5xx, 429...) — achado de code review: o
        // BFF pode retornar 502 durante o próprio deploy (blue/green,
        // alguns segundos de indisponibilidade); sem retry aqui, isso
        // reproduziria o MESMO travamento permanente que este fix existe
        // pra resolver, só que via um status HTTP em vez de erro de rede.
        scheduleRetry(attempt);
      } catch {
        // Falha de rede/timeout (não uma resposta HTTP completa) — mesmo
        // tratamento: transitório, tenta de novo.
        scheduleRetry(attempt);
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
      cancelled = true;
      // Libera o guard mesmo se uma chamada desta execução do efeito ainda
      // estiver em voo — sem isso, uma re-execução do efeito (troca de
      // rota) enquanto getUser() está pendente podia deixar o guard preso
      // em `true` indefinidamente (achado de review de urgência), já que
      // só a chamada original resetaria (e ela nunca mais agenda retry
      // depois de `cancelled=true`).
      revalidatingRef.current = false;
      if (retryTimer) clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("blur", hide);
    };
  }, [dashboardRoute]);

  return (
    <div
      data-testid="resume-mask-overlay"
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

const SW_UPDATE_CHECK_INTERVAL_MS = 60_000;

// RECUO DELIBERADO (2026-07-17): esta função já teve uma versão com
// reload automático via evento `controllerchange`, projetada pra manter
// o app sempre na versão mais nova sem exigir reinstalação manual do
// PWA (pedido explícito do usuário). Passou por 2 rodadas de correção
// (janela de carência, guard de mutação em voo) e AINDA ASSIM continuou
// causando `net::ERR_ABORTED` em navegações reais (reproduzido em
// produção: fluxo de login abortado mesmo com as duas correções
// aplicadas) — 3 incidentes seguidos no mesmo mecanismo é sinal de que o
// design tem uma categoria de risco que essas correções pontuais não
// fecham por completo (qualquer timer fixo correndo contra uma navegação
// de duração indeterminada tem essa classe de problema). Removido o
// reload forçado; mantida só a checagem periódica abaixo, que é inofensiva
// (só pergunta ao browser "há uma versão nova?", nunca interrompe nada).
// `skipWaiting`+`clientsClaim` (sw.ts) já garantem que o novo SW assume
// controle assim que instala — o usuário recebe a versão nova na PRÓXIMA
// navegação real dele (troca de página, boa parte do app já usa
// `window.location.href` — full reload — em vez de navegação client-side,
// então isso acontece com frequência natural). Não é mais "instantâneo
// silencioso", mas é seguro. Revisitar com um design mais robusto (ex:
// notificar e deixar o reload a cargo de um clique do usuário, padrão
// canônico do workbox-window) antes de tentar o auto-reload de novo.
function ServiceWorkerUpdater() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    function checkForUpdate() {
      navigator.serviceWorker.getRegistration()
        .then((reg) => reg?.update())
        .catch(() => {});
    }

    checkForUpdate();
    const interval = setInterval(checkForUpdate, SW_UPDATE_CHECK_INTERVAL_MS);

    function onVisibilityChange() {
      if (document.visibilityState === "visible") checkForUpdate();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
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
        <ResumeMaskOverlay />
        {children}
        <Toaster richColors closeButton />
      </ThemeProvider>
      {process.env.NODE_ENV === "development" && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
