import { z } from "zod";
import { escapeHtml } from "./_escape.ts";
import type { TemplateDef } from "./index.ts";

// Duplo opt-in de troca de e-mail de acesso (spec:
// docs/enterprise/specs/troca-email-acesso-enterprise.md §5.1/§6). Enviado
// para o e-mail NOVO quando um admin solicita a troca — o link aponta para
// GET /api/auth/email-change/confirm, que só RENDERIZA uma página de
// confirmação (nunca executa a troca no GET — evita que um scanner
// corporativo de e-mail que pré-busca links complete a troca sem o usuário
// nunca ter visto a mensagem). A troca de fato só acontece quando o usuário
// clica no botão daquela página, que dispara o POST. Categoria `lifecycle`
// (ação esperada, não um alerta de intrusão em si — o alerta de segurança é
// o template email-changed-notice, disparado só depois da confirmação).
export const emailChangeConfirm: TemplateDef<{ url: string }> = {
  category: "lifecycle",
  schema: z
    .object({
      url: z.string().url().max(500),
    })
    .strict(),
  build: (data: { url: string }, _ctx, recipient) => {
    const nome = escapeHtml(recipient.nome || "militar");
    return {
      subject: "Confirme a troca do seu e-mail de acesso — Andrômeda",
      bodyHtml:
        `<p style="margin:0 0 12px;">Olá, ${nome}.</p>` +
        `<p style="margin:0 0 12px;">Um administrador solicitou a troca do seu e-mail de acesso ao <strong>Andrômeda</strong> para este endereço.</p>` +
        `<p style="margin:0 0 12px;">Se foi você (ou seu administrador, a seu pedido), confirme abaixo. O link expira em 1 hora e só pode ser usado uma vez.</p>` +
        `<p style="margin:0;">Se você não esperava esta mensagem, ignore-a — nada será alterado sem esta confirmação.</p>`,
      bodyText:
        `Olá, ${recipient.nome || "militar"}.\n\n` +
        `Um administrador solicitou a troca do seu e-mail de acesso ao Andrômeda para este endereço. ` +
        `Se foi você (ou seu administrador, a seu pedido), confirme usando o link abaixo. Expira em 1 hora, uso único.\n\n` +
        `Se você não esperava esta mensagem, ignore-a — nada será alterado sem esta confirmação.`,
      cta: { label: "Confirmar novo e-mail", url: data.url },
    };
  },
};
