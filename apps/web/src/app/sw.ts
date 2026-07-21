import { defaultCache } from "@serwist/next/worker";
import { NetworkFirst, NetworkOnly, Serwist } from "serwist";

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
      handler: new NetworkOnly(),
    },
    {
      // RSC payload das navegações client-side do App Router (header `RSC: 1`,
      // com ou sem prefetch) — nunca deve vir do cache, mesmo motivo do
      // matcher de navegação acima.
      matcher: ({ request, url: { pathname }, sameOrigin }) =>
        sameOrigin &&
        !pathname.startsWith("/api/") &&
        request.headers.get("RSC") === "1",
      handler: new NetworkOnly(),
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
