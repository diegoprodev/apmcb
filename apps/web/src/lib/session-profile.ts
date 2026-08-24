import { cache } from "react";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

// Contadores dev-only (PERF-02, spec §8, "teste de contagem de chamadas de
// rede") — incrementados só quando o CORPO da função cache()-wrapped roda de
// verdade (cache miss), nunca em cache hit. É a única forma de provar, contra
// o pipeline real de RSC do `next dev`, que layout.tsx + page.tsx dentro do
// MESMO request somam 1 chamada, não 2 — um teste isolado (Vitest/mock) não
// prova isso: cache() do React só deduplica dentro do dispatcher real do
// Next (confirmado empiricamente; um harness próprio fora dele produz falso
// negativo mesmo com este arquivo correto).
//
// Lidos via um marcador oculto no DOM da própria página (ver
// reserva/arsenal/page.tsx), NÃO via uma API route separada — achado
// (descoberto tentando a 1ª versão desta instrumentação): Next.js compila
// Server Components (layout/page) e Route Handlers (api/.../route.ts) em
// grafos de módulo SEPARADOS mesmo em dev, então um contador módulo-level
// como este NUNCA é compartilhado entre um page.tsx e uma api route que
// importem o "mesmo" arquivo — cada um vê sua própria instância. Resetado
// no topo de (dashboard)/layout.tsx a cada request (mesma camada que
// page.tsx, sem esse problema). Nunca renderizado em produção — todo uso
// é gated por `process.env.NODE_ENV !== "production"`.
//
// Limitação conhecida (achado MÉDIO de code review): é estado de módulo
// GLOBAL, não escopado por request de verdade — `next dev` roda num único
// processo Node, então duas navegações sobrepostas (prefetch de <Link>,
// múltiplas abas) PODEM fazer uma request B resetar o contador enquanto a
// request A ainda está em voo, corrompendo o valor que A lê no fim do
// render. navigation-perf.spec.ts roda com `workers: 1` especificamente
// por causa disso — evita a sobreposição, não a elimina estruturalmente.
// Um valor incorreto aqui é flakiness de teste, nunca indica um bug real
// de dedup do cache() (esse continua sendo request-scoped de verdade pelo
// dispatcher do React/Next, só este contador auxiliar não é).
export const perf02DebugCounters = { getUserCalls: 0, getSessionProfileCalls: 0 };

// PERF-02 (docs/enterprise/specs/navegacao-performance-enterprise.md): dedup
// de supabase.auth.getUser()+profiles entre (dashboard)/layout.tsx e cada
// page.tsx via cache() do React — memoização por request, dentro da mesma
// árvore de Server Components.
//
// SEM parâmetro de supabase client: createClient() é chamado por dentro de
// cada função, não recebido de fora. Achado CRÍTICO de code review:
// cache() compara argumentos por identidade estrita (Object.is), e
// apps/web/src/lib/supabase/server.ts:createClient() nunca retorna a mesma
// instância entre chamadas — se getSessionUser recebesse `supabase` como
// parâmetro, layout.tsx e cada page.tsx passariam instâncias DIFERENTES
// (cada um já chama createClient() por conta própria pras suas outras
// queries), e como instâncias diferentes nunca colidem no cache por
// identidade, a dedução inteira seria um no-op silencioso — os dois
// round-trips de rede continuariam acontecendo. Sem parâmetro nenhum,
// cache() memoiza puramente por "esta função async já rodou neste
// request?", sem depender de identidade de objeto externa.
// getSessionProfile(userId) recebe só a string do id (primitivo —
// Object.is compara primitivos por valor, então duas chamadas com o mesmo
// id resolvido colidem corretamente no cache).
//
// NUNCA usar getSessionUser() no recheck de session-mismatch em
// (dashboard)/layout.tsx — esse recheck precisa de uma leitura NOVA e
// independente da 1ª via supabase.auth.getUser() direto (ver comentário
// no próprio layout.tsx e §4 da spec) — é o que permite decideSessionMismatch
// distinguir divergência transitória de incidente confirmado. Migrar essa
// chamada pra cache() faria o resultado ser sempre igual à 1ª leitura,
// quebrando essa distinção silenciosamente.
export const getSessionUser = cache(async () => {
  perf02DebugCounters.getUserCalls++;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Monitoramento mandatório (spec §8/§9, achado CRÍTICO de code review):
  // compara a identidade resolvida aqui contra x-verified-user-id
  // (middleware.ts, resolveVerifiedUserId) em TODA request — não só quando
  // (dashboard)/layout.tsx já decide agir sobre uma divergência (esse guard
  // continua intacto e é quem decide redirect/fail-closed; ver layout.tsx).
  // Este é o ÚNICO ponto de leitura real por request (cache() do PERF-02
  // deduplica todo o resto — um cache HIT nunca re-executa este corpo), então
  // é também o único ponto que precisa deste log pra cobrir os 28 pontos de
  // consumo do PERF-02 (26 page.tsx + 2 layouts) sem duplicar a checagem em
  // cada um. Nunca bloqueia o render — só observabilidade, correlacionando
  // com o precedente real de session-bleed (2026-07-17) citado na spec §4.
  const verifiedUserId = (await headers()).get("x-verified-user-id");
  if (verifiedUserId && user && verifiedUserId !== user.id) {
    console.error("[perf02-identity-monitor]", {
      resolvedByGetSessionUser: user.id,
      verifiedByBff: verifiedUserId,
      at: new Date().toISOString(),
    });
  }

  return user;
});

// União de 11 colunas — auditada via grep contra TODO `.select()` que hoje
// filtra profiles por `id = user.id` nos 28 pontos de aplicação do PERF-02
// (layout.tsx + efetivo/layout.tsx + 26 page.tsx), não uma estimativa.
// Páginas que precisam de menos colunas apenas destroturam o que usam, sem
// custo extra de query.
const SESSION_PROFILE_COLUMNS =
  "id, role, nome_completo, foto_url, registration_status, posto, nome_de_guerra, default_tenant_id, matricula, totp_configured, created_at";

export const getSessionProfile = cache(async (userId: string) => {
  perf02DebugCounters.getSessionProfileCalls++;
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select(SESSION_PROFILE_COLUMNS)
    .eq("id", userId)
    .single();
  return data;
});
