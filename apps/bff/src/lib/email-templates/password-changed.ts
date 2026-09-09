import { z } from "zod";
import { escapeHtml } from "./_escape.ts";
import type { TemplateDef } from "./index.ts";

// Fase 1 — aviso de senha alterada. Categoria `security`: nunca silenciado sob
// throttle/cota (O7). Disparado após o reset self-service concluir
// (apps/web/src/app/api/auth/update-password/route.ts). Sem link, sem token,
// sem senha — só a notificação e a orientação.
export const passwordChanged: TemplateDef<{ quando: string }> = {
  category: "security",
  schema: z.object({ quando: z.string().min(1).max(60) }).strict(),
  build: (data: { quando: string }, _ctx, recipient) => {
    const nome = escapeHtml(recipient.nome || "militar");
    const quando = escapeHtml(data.quando);
    return {
      subject: "Sua senha do Andrômeda foi alterada",
      bodyHtml:
        `<p style="margin:0 0 12px;">Olá, ${nome}.</p>` +
        `<p style="margin:0 0 12px;">A senha da sua conta no sistema Andrômeda foi alterada em <strong>${quando}</strong>.</p>` +
        `<p style="margin:0 0 12px;">Se foi você, nenhuma ação é necessária.</p>` +
        `<p style="margin:0;">Se você não reconhece esta alteração, procure imediatamente o administrador da sua unidade — sua conta pode estar comprometida.</p>`,
      bodyText:
        `Olá, ${recipient.nome || "militar"}.\n\n` +
        `A senha da sua conta no sistema Andrômeda foi alterada em ${data.quando}.\n\n` +
        `Se foi você, nenhuma ação é necessária. Se você não reconhece esta alteração, ` +
        `procure imediatamente o administrador da sua unidade — sua conta pode estar comprometida.`,
    };
  },
};
