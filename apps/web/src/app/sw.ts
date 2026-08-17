import { defaultCache } from "@serwist/next/worker";
import { NetworkFirst, NetworkOnly, Serwist } from "serwist";
import type { SerwistPlugin } from "serwist";

declare const self: ServiceWorkerGlobalScope & {
  __SW_MANIFEST: (string | { url: string; revision: string | null })[];
};

// manifest.webmanifest excluído do precache estático — achado real desta
// sessão (docs/superpowers/specs/2026-07-17-pwa-native-boot-experience-design.md
// seção 3.2): confirmado empiricamente que o Serwist precacheia esse
// arquivo junto com o resto do build. Se ficasse no precache, um PWA já
// instalado continuaria servindo o manifest ANTIGO (ícones/splash velhos)
// até o SW atualizar — timing não determinístico (skipWaiting+clientsClaim
// ajudam mas iOS pode demorar pra sequer checar update). runtimeCaching
// NetworkFirst abaixo garante que o manifest sempre vem da rede primeiro,
// só caindo pro cache em falha de rede — elimina a fonte do risco em vez
// de só depender de aviso ao usuário pra fazer cold-start online.
const precacheEntries = self.__SW_MANIFEST.filter(
  (entry) => (typeof entry === "string" ? entry : entry.url) !== "/manifest.webmanifest"
);

// Cross-origin requests (BFF, Supabase) must NEVER be served from cache.
// If the network fails for these, the SW returns the error directly — no fallback loop.
//
// Achado real (2026-07-20): o `defaultCache` do @serwist/next cacheia RSC
// payload e HTML de página via NetworkFirst com expiração de 24h, sem
// nenhum vínculo ao hash do build atual (ao contrário do precache estático,
// que é versionado por hash de asset). Numa navegação client-side que sofre
// qualquer instabilidade de rede (troca de aba, app em segundo plano,
// conexão instável), o Serwist cai para esse cache — servindo HTML/RSC de
// até 24h atrás contra o bundle JS ATUAL em memória, produzindo mismatch
// estrutural na hidratação (React #418) ou, sem cache disponível ainda,
// rejeitando com "no-response". Este é um dashboard em tempo real, não um
// site majoritariamente estático — conteúdo dinâmico (RSC/HTML) nunca deve
// ser servido do cache, só assets com nome hasheado por build (cobertos
// pelos matchers de asset estático do defaultCache, que são seguros: um
// novo deploy gera uma URL nova, nunca reaproveitando um arquivo antigo).
// ── Fallback gracioso pra falha genuína de rede numa navegação ────────────────
// Achado real (relatório de produto, 2026-07-26 ~16h): "Uncaught (in promise)
// no-response" no console, na navegação para /reserva/arsenal/manutencao.
// Investigado: NÃO é o mesmo bug de 2026-07-20 documentado acima (cache
// servindo HTML velho) — aqui o fetch da rede genuinamente falhou (sem
// conexão, aba em segundo plano, troca de rede no meio da navegação) e
// NetworkOnly, por design, rejeita sem fallback pra cache (correto — manter).
// O que É um gap real: sem nenhum handler, essa rejeição sobe como promise
// não tratada (ruído de console sem contexto) e o usuário vê a tela de erro
// NATIVA do browser em vez de qualquer coisa da APMCB. `handlerDidError` é o
// hook de plugin do próprio Serwist/Workbox pra exatamente esse caso (ver
// node_modules/serwist/dist/chunks/types-*.d.ts, SerwistPlugin.handlerDidError) —
// intercepta só esse último elo, sem tocar na estratégia NetworkOnly em si.
//
// Só a navegação de documento completo (mode:"navigate") recebe uma Response
// substituta (uma página offline mínima, autocontida) — é seguro porque o
// browser só espera um documento HTML ali. Pro matcher de RSC payload logo
// abaixo, devolver uma Response fabricada quebraria o parser de flight do
// Next.js (formato não é HTML), então ali só logamos de forma limpa e
// deixamos a rejeição subir como já acontece hoje — o router do Next já trata
// falha de fetch de RSC caindo para navegação completa.
const OFFLINE_HTML = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sem conexão — APMCB</title>
<style>
/* Tokens copiados de globals.css (--background/--foreground/--muted-foreground/
   --primary/--primary-foreground) — achado de code review: a 1ª versão só
   trazia o tema escuro fixo, invertendo bruscamente as cores pra quem usa o
   app no tema claro e cai offline. Sem acesso a variáveis CSS custom (esta
   página é servida standalone, fora da árvore normal do Next), os valores
   HSL são copiados diretamente, escuro primeiro (@media prefers-color-scheme
   é o único sinal de tema disponível aqui, sem cookie/localStorage do app). */
html,body{height:100%;margin:0}
body{display:flex;align-items:center;justify-content:center;
background:hsl(240 29% 5%);color:hsl(240 17% 95%);
font-family:system-ui,-apple-system,"Segoe UI",sans-serif;
text-align:center;padding:24px;box-sizing:border-box}
.card{max-width:340px}
h1{font-size:1.05rem;font-weight:600;margin:0 0 8px}
p{font-size:.875rem;color:hsl(240 9% 60%);margin:0 0 20px;line-height:1.5}
button{background:hsl(213 93% 67%);color:hsl(240 29% 5%);border:none;border-radius:8px;
padding:10px 20px;font-size:.875rem;font-weight:600;cursor:pointer}
button:hover{opacity:.9}
@media (prefers-color-scheme: light) {
  body{background:hsl(220 14% 96%);color:hsl(234 36% 14%)}
  p{color:hsl(220 9% 46%)}
  button{background:hsl(224 68% 32%);color:hsl(0 0% 100%)}
}
</style></head>
<body><div class="card">
<h1>Sem conexão com o servidor</h1>
<p>Não foi possível carregar esta página. Verifique sua internet e tente novamente.</p>
<button onclick="location.reload()">Tentar novamente</button>
</div></body></html>`;

const navigationErrorPlugin: SerwistPlugin = {
  handlerDidError: async ({ request, error }) => {
    console.warn("[sw] navegação falhou (rede indisponível) — servindo fallback offline", {
      url: request.url,
      error: error.message,
    });
    return new Response(OFFLINE_HTML, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
};

const rscFetchErrorLogPlugin: SerwistPlugin = {
  handlerDidError: async ({ request, error }) => {
    console.warn("[sw] fetch de RSC (navegação client-side) falhou — rede indisponível", {
      url: request.url,
      error: error.message,
    });
    // Sem `return` de Response: deixa o erro original subir, igual ao
    // comportamento de hoje — o router do Next já sabe cair para navegação
    // completa quando o fetch de um RSC payload falha.
    return undefined;
  },
};

const serwist = new Serwist({
  precacheEntries,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: [
    {
      matcher: ({ url: { pathname }, sameOrigin }) =>
        sameOrigin && pathname === "/manifest.webmanifest",
      handler: new NetworkFirst(),
    },
    {
      matcher: ({ request, url: { pathname }, sameOrigin }) =>
        sameOrigin &&
        !pathname.startsWith("/api/") &&
        request.mode === "navigate",
      handler: new NetworkOnly({ plugins: [navigationErrorPlugin] }),
    },
    {
      // RSC payload das navegações client-side do App Router (header `RSC: 1`,
      // com ou sem prefetch) — nunca deve vir do cache, mesmo motivo do
      // matcher de navegação acima.
      matcher: ({ request, url: { pathname }, sameOrigin }) =>
        sameOrigin &&
        !pathname.startsWith("/api/") &&
        request.headers.get("RSC") === "1",
      handler: new NetworkOnly({ plugins: [rscFetchErrorLogPlugin] }),
    },
    {
      matcher: ({ url }) => url.origin !== self.location.origin,
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();

// ── Web Push handler ──────────────────────────────────────────────────────────

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload: {
    title?: string;
    body?: string;
    url?: string;
    icon?: string;
    badge?: string;
  } = {};

  try {
    payload = event.data.json();
  } catch {
    payload = { title: "APMCB", body: event.data.text() };
  }

  const title = payload.title ?? "APMCB";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const options: any = {
    body: payload.body ?? "",
    icon: payload.icon ?? "/images/logo.png",
    badge: payload.badge ?? "/images/logo.png",
    data: { url: payload.url ?? "/" },
    tag: "apmcb-notification",
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url: string = (event.notification.data as { url?: string })?.url ?? "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url === url && "focus" in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(url);
        }
      })
  );
});
