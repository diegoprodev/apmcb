"use client";

import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
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

// BUG CRÍTICO DE PRODUÇÃO (2026-07-17, corrigido): reproduzido com
// evidência direta (3 de 4 tentativas locais contra produção, mesmo
// padrão do CI) — sem essa janela de carência, `controllerchange` podia
// disparar `window.location.reload()` bem no meio da navegação
// exchange→landAt do login (window.location.href = landAt), ABORTANDO
// essa navegação (`net::ERR_ABORTED` em /admin) — exatamente quando um
// deploy novo acabava de sair (SW da página ainda um passo atrás do que
// tinha acabado de subir, cenário comum durante deploys em sequência
// rápida, mas também real em produção normal logo após qualquer deploy).
// Durante os primeiros SW_UPDATE_GRACE_MS após o mount, um
// `controllerchange` só marca `pendingReload`, nunca chama `doReload()`
// direto — dá tempo de QUALQUER redirect/navegação já em andamento
// (login, troca de rota) terminar antes de um reload concorrente entrar
// no meio do caminho.
//
// 20s, não 8s — achado de code review na correção acima: 8s era MENOR
// que o próprio pior caso já documentado do fluxo que essa janela deveria
// proteger (`apps/web/src/app/auth/exchange/page.tsx`: até 15s de abort
// timeout no POST /api/auth/exchange, e o `fetch("/api/auth/upgrade-session")`
// logo depois NEM TEM AbortSignal — pode ficar pendurado até ~75s de
// timeout default do browser em rede degradada). Como a condição que
// dispara um controllerchange (deploy novo) tende a coincidir no tempo
// com a condição que deixa o BFF lento (deploy do BFF em andamento), os
// dois riscos se correlacionam — não é um edge case teórico. Se o valor
// de qualquer um dos dois mudar no futuro, o outro precisa ser revisado
// junto.
const SW_UPDATE_GRACE_MS = 20_000;

// Mantém o app sempre na versão mais recente, sem nenhuma ação manual do
// usuário (nunca pedir "apague e reinstale o ícone" — isso não escala pra
// produção real com milhares de usuários). Duas partes:
//
// 1. Checagem ativa e PERIÓDICA de atualização do SW — @serwist/next
//    registra o SW automaticamente, mas a checagem de "há uma versão
//    nova?" é passiva por padrão (o browser decide quando checar). iOS em
//    modo PWA é conhecidamente preguiçoso nisso, podendo ficar semanas
//    rodando um SW desatualizado se só checar uma vez por mount. Poll a
//    cada 60s enquanto o app está em foreground + checagem imediata ao
//    voltar de background (`visibilitychange`) cobre tanto sessões longas
//    quanto cold-launches.
// 2. `controllerchange` → reload automático: `skipWaiting`+`clientsClaim`
//    (já configurados em sw.ts) fazem o novo SW assumir controle da
//    página assim que instala, SEM esperar todas as abas fecharem — o
//    evento `controllerchange` dispara exatamente nesse momento. Recarregar
//    a página nesse instante garante que o HTML/JS servido passa a vir do
//    novo build imediatamente, sem depender do usuário navegar/reabrir o
//    app manualmente. Diferente do padrão canônico do workbox-window (que
//    só notifica e deixa o reload a cargo de um clique do usuário) —
//    escolhido deliberadamente auto/silencioso aqui pra zero fricção, com
//    uma guarda (isUserEditing) pra não derrubar um formulário longo em
//    andamento (achado de code review) — adia até o campo perder foco ou
//    o app sair/voltar de background.
// Formulário longo em andamento (cadastro de arsenal, TCO, ocorrência) não
// pode ser derrubado por um reload silencioso disparado no meio do
// preenchimento — achado de code review. Sinal simples e sem dependência
// de estado de formulário nenhum: existe elemento de input focado agora?
function isUserEditing(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable;
}

function ServiceWorkerUpdater() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let reloading = false;
    let pendingReload = false;
    let readyForReload = false;

    // Reload seguro exige as DUAS condições: janela de carência já
    // passada E nenhuma mutação/edição em andamento. Achado de code
    // review: `isUserEditing()` sozinho só cobre foco em campo de texto,
    // não cobre uma mutação React Query em voo (ex: confirmar devolução
    // de arma, TCO, ocorrência — disparada por clique de botão, sem
    // nenhum elemento de texto focado) — num sistema de custódia de
    // armamento, abortar essa chamada de rede no meio é pior que abortar
    // um redirect.
    function canReloadNow(): boolean {
      return !isUserEditing() && queryClient.isMutating() === 0;
    }

    function doReload() {
      // Evita loop de reload caso o evento dispare mais de uma vez —
      // legítimo (skipWaiting garante um único take-over por deploy), mas
      // não custa nada garantir.
      if (reloading) return;
      reloading = true;
      window.location.reload();
    }

    function onControllerChange() {
      if (!readyForReload || !canReloadNow()) {
        // Adia o reload — durante a janela de carência (readyForReload
        // ainda false) pra não abortar um redirect/navegação já em
        // andamento (ex: login), ou porque há edição/mutação em curso.
        // Tenta de novo quando a janela passar, o campo perder foco
        // (`focusout`), ou o app sair/voltar de background.
        pendingReload = true;
        return;
      }
      doReload();
    }
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    const graceTimer = setTimeout(() => {
      readyForReload = true;
      if (pendingReload && canReloadNow()) doReload();
    }, SW_UPDATE_GRACE_MS);

    function onFocusOut() {
      if (readyForReload && pendingReload && canReloadNow()) doReload();
    }
    document.addEventListener("focusout", onFocusOut);

    function checkForUpdate() {
      navigator.serviceWorker.getRegistration()
        .then((reg) => reg?.update())
        .catch(() => {});
    }

    checkForUpdate();
    const interval = setInterval(checkForUpdate, SW_UPDATE_CHECK_INTERVAL_MS);

    function onVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      // achado de code review: faltava !isUserEditing() aqui (agora
      // canReloadNow() cobre os dois), mesmo padrão dos outros handlers —
      // sem isso, voltar de outra aba com um campo ainda focado podia
      // disparar reload no meio do preenchimento.
      if (readyForReload && pendingReload && canReloadNow()) { doReload(); return; }
      checkForUpdate();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      clearInterval(interval);
      clearTimeout(graceTimer);
      document.removeEventListener("focusout", onFocusOut);
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
