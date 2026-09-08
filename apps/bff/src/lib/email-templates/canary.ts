import { z } from "zod";
import { escapeHtml } from "./_escape.ts";
import type { TemplateDef } from "./index.ts";

// Canário sintético (plano §D14 / Fase 0 passo 6): disparado por pg_cron a cada
// 15 min contra delivered@resend.dev. Se parar de aparecer `email.sent`, o
// alerta indica Resend fora do ar ou cota estourada.
export const canary: TemplateDef<{ nonce: string }> = {
  category: "lifecycle",
  schema: z.object({ nonce: z.string().min(1).max(64) }).strict(),
  build: (data: { nonce: string }) => ({
    subject: "APMCB — verificação de entrega",
    bodyHtml: `<p style="margin:0;">Verificação automática de entrega de e-mail. Nenhuma ação é necessária.</p>
<p style="margin:16px 0 0;color:#6b7280;font-size:13px;">Referência: ${escapeHtml(data.nonce)}</p>`,
    bodyText: `Verificação automática de entrega de e-mail. Nenhuma ação é necessária.\n\nReferência: ${data.nonce}`,
  }),
};
