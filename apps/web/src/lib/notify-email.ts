import "server-only";

// Cliente fino edge→BFF para disparar e-mail transacional (plano §3.6 / Fase 0).
// O Resend vive só no BFF; a web nunca fala com ele. Fire-and-forget: nunca
// aguardado, timeout curto, `.catch` engole — um e-mail nunca pode atrasar
// nem quebrar a resposta de um fluxo de auth (O6).
//
// `recipient_id` (não `to`): o endereço e o nome vêm do lookup em `profiles`
// no BFF, nunca do payload daqui. `data` carrega só o que apenas o caller
// sabe (quando, dispositivo, origem, papel).
//
// ⚠️ Runtime edge (CF Pages): trabalho pendente APÓS a resposta ser devolvida
// não tem garantia de execução sem `ctx.waitUntil()`. Cada call site (a
// partir da Fase 1) deve registrar o retorno em `waitUntil` OU aguardar. Ver
// `getRequestContext().ctx.waitUntil(...)` de `@cloudflare/next-on-pages`.

export type EmailTemplate =
  | "welcome"
  | "password_changed"
  | "new_login"
  | "invite";

export type EmailCategory = "security" | "lifecycle";

// Retorna uma Promise que SEMPRE resolve (nunca rejeita). O caller pode:
//   - ignorá-la (fire-and-forget, mas o edge pode matar o trabalho pendente); ou
//   - `getRequestContext().ctx.waitUntil(sendTransactionalEmail(...))` (recomendado).
export async function sendTransactionalEmail(
  template: EmailTemplate,
  recipientId: string,
  data: Record<string, unknown>,
  category: EmailCategory,
): Promise<void> {
  const bffUrl = process.env.BFF_URL ?? process.env.NEXT_PUBLIC_BFF_URL ?? "";
  const secret = process.env.INTERNAL_EMAIL_SECRET ?? "";
  if (!bffUrl || !secret) {
    console.error("[notify-email] BFF_URL ou INTERNAL_EMAIL_SECRET ausente — e-mail não disparado");
    return;
  }

  try {
    await fetch(`${bffUrl}/api/internal/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-email-secret": secret,
      },
      body: JSON.stringify({ template, recipient_id: recipientId, data, category }),
      signal: AbortSignal.timeout(3000),
    });
  } catch (err) {
    console.error("[notify-email] falha ao chamar o BFF:", err instanceof Error ? err.message : err);
  }
}
