// Monta o link do e-mail de acesso/recuperação apontando DIRETO para o Route
// Handler `/auth/callback` do frontend, com `token_hash` + `type=recovery` +
// `next=/auth/update-password` na query.
//
// Por que NÃO usar o `action_link` de `supabase.auth.admin.generateLink`: aquele
// link roteia pelo endpoint GoTrue `/auth/v1/verify`, que responde com os tokens
// da sessão no FRAGMENTO (`#access_token=...`) — implicit flow, já que um link
// gerado no servidor não carrega desafio PKCE. O `/auth/callback` é um Route
// Handler server-side e não enxerga o fragmento, então caía sempre em
// `/auth/error` (bug de produção 2026-09-09). Passando `token_hash` na query, o
// próprio handler chama `verifyOtp` no servidor e cria a sessão em cookies, sem
// fragmento. Ver apps/web/src/app/auth/callback/route.ts (bloco HARDENED_OTP_TYPES).

// Único destino emitido. `/auth/update-password` também consta do
// ALLOWED_NEXT_PATHS do callback (route.ts) — se um dia divergir, o callback
// rebaixa `next` para "/" e o teste de contrato em route.test.ts quebra.
const CALLBACK_NEXT = "/auth/update-password";

// `hashed_token` do GoTrue é hex minúsculo (SHA-224 = 56 chars hoje). Faixa
// larga o suficiente para tolerar mudança de algoritmo, estreita o suficiente
// para rejeitar qualquer coisa que não seja um hash.
const HASHED_TOKEN_RE = /^[a-f0-9]{40,128}$/;

export interface BuildRecoveryCallbackLinkInput {
  /** URL base do frontend (ex.: https://apmcb.pmpb.online). Barra(s) final(is) toleradas. */
  frontendUrl: string;
  /** `properties.hashed_token` devolvido por `generateLink({ type: "recovery" })`. */
  hashedToken: string;
}

export function buildRecoveryCallbackLink(input: BuildRecoveryCallbackLinkInput): string {
  const { frontendUrl, hashedToken } = input;

  if (typeof hashedToken !== "string" || !HASHED_TOKEN_RE.test(hashedToken)) {
    throw new Error("buildRecoveryCallbackLink: hashedToken ausente ou fora do formato");
  }
  if (typeof frontendUrl !== "string" || !/^https?:\/\/[^\s/]+/i.test(frontendUrl)) {
    throw new Error("buildRecoveryCallbackLink: frontendUrl inválida");
  }

  const base = frontendUrl.replace(/\/+$/, "");
  const qs = new URLSearchParams({
    token_hash: hashedToken,
    type: "recovery",
    next: CALLBACK_NEXT,
  });
  return `${base}/auth/callback?${qs.toString()}`;
}
