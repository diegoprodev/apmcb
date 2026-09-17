import { z } from "zod";
import { escapeHtml } from "./_escape.ts";
import type { TemplateDef } from "./index.ts";

// Aviso de segurança pós-confirmação de troca de e-mail (spec:
// docs/enterprise/specs/troca-email-acesso-enterprise.md §5.2/§6). Disparado
// DUAS vezes pelo endpoint de confirmação — uma para `old_email`, uma para
// `new_email` — sempre via `services/email.ts`'s `sendEmail()` DIRETO
// (nunca `sendTransactionalEmail`/orquestrador, que só sabe resolver o
// e-mail ATUAL da pessoa em `profiles`, já seria o novo neste ponto; o
// endereço antigo não tem mais nenhum jeito de ser alcançado por lookup).
// Categoria `security`: nunca throttled (regra O7) — mesmo molde de
// password-changed.ts, sem link/CTA, sem token, só a orientação.
export const emailChangedNotice: TemplateDef<{ old_email: string; new_email: string; quando: string }> = {
  category: "security",
  schema: z
    .object({
      old_email: z.string().email().max(255),
      new_email: z.string().email().max(255),
      quando: z.string().min(1).max(60),
    })
    .strict(),
  build: (data: { old_email: string; new_email: string; quando: string }, _ctx, recipient) => {
    const nome = escapeHtml(recipient.nome || "militar");
    const oldEmail = escapeHtml(data.old_email);
    const newEmail = escapeHtml(data.new_email);
    const quando = escapeHtml(data.quando);
    return {
      subject: "Seu e-mail de acesso ao Andrômeda foi alterado",
      bodyHtml:
        `<p style="margin:0 0 12px;">Olá, ${nome}.</p>` +
        `<p style="margin:0 0 12px;">O e-mail de acesso da sua conta no Andrômeda foi alterado de <strong>${oldEmail}</strong> para <strong>${newEmail}</strong> em <strong>${quando}</strong>, por um administrador.</p>` +
        `<p style="margin:0 0 12px;">Se você reconhece esta ação, nenhuma providência é necessária.</p>` +
        `<p style="margin:0;"><strong>Se você não reconhece esta alteração, procure imediatamente o administrador da sua unidade — sua conta pode estar comprometida.</strong></p>`,
      bodyText:
        `Olá, ${recipient.nome || "militar"}.\n\n` +
        `O e-mail de acesso da sua conta no Andrômeda foi alterado de ${data.old_email} para ${data.new_email} em ${data.quando}, por um administrador.\n\n` +
        `Se você reconhece esta ação, nenhuma providência é necessária. Se você NÃO reconhece esta alteração, ` +
        `procure imediatamente o administrador da sua unidade — sua conta pode estar comprometida.`,
    };
  },
};
