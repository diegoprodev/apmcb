import { z } from "zod";
import { escapeHtml } from "./_escape.ts";
import type { TemplateDef } from "./index.ts";

// Achado de code review (spec
// docs/enterprise/specs/troca-email-acesso-enterprise.md, revisão adversarial
// antes do commit): o link de confirmação (email-change-confirm.ts) só vai
// pro endereço NOVO — que é escolhido pelo PRÓPRIO admin solicitante. Um
// admin malicioso/comprometido consegue clicar seu próprio link sem
// problema nenhum; o "duplo opt-in" (D2) sozinho não protege contra esse
// ator, só contra confirmação automática por scanner de e-mail (já resolvido
// noutro achado). A proteção real contra admin malicioso é avisar o
// endereço ANTIGO — que só o dono de fato da conta ainda controla — ANTES
// da troca ter efeito, não só depois (email-changed-notice.ts, que já
// dispara pós-confirmação mas é tarde demais para IMPEDIR qualquer coisa).
// Categoria `security`: nunca throttled. Sem CTA — não há ação seguinca a
// tomar por link, só a orientação de contato se o pedido for inesperado.
export const emailChangeRequestedNotice: TemplateDef<{ new_email: string; quando: string }> = {
  category: "security",
  schema: z
    .object({
      new_email: z.string().email().max(255),
      quando: z.string().min(1).max(60),
    })
    .strict(),
  build: (data: { new_email: string; quando: string }, _ctx, recipient) => {
    const nome = escapeHtml(recipient.nome || "militar");
    const newEmail = escapeHtml(data.new_email);
    const quando = escapeHtml(data.quando);
    return {
      subject: "Solicitação de troca do seu e-mail de acesso — Andrômeda",
      bodyHtml:
        `<p style="margin:0 0 12px;">Olá, ${nome}.</p>` +
        `<p style="margin:0 0 12px;">Em <strong>${quando}</strong>, um administrador solicitou a troca do e-mail de acesso da sua conta no <strong>Andrômeda</strong> para <strong>${newEmail}</strong>.</p>` +
        `<p style="margin:0 0 12px;">A troca ainda NÃO teve efeito — só passa a valer depois que alguém confirmar pelo link enviado ao endereço novo.</p>` +
        `<p style="margin:0;">Se você reconhece e autorizou este pedido, nenhuma ação é necessária. <strong>Se você não esperava esta mensagem, contate imediatamente o administrador da sua unidade antes que a troca seja confirmada — sua conta pode estar sendo alvo de uma tentativa de sequestro.</strong></p>`,
      bodyText:
        `Olá, ${recipient.nome || "militar"}.\n\n` +
        `Em ${data.quando}, um administrador solicitou a troca do e-mail de acesso da sua conta no Andrômeda para ${data.new_email}.\n\n` +
        `A troca ainda NÃO teve efeito — só passa a valer depois que alguém confirmar pelo link enviado ao endereço novo.\n\n` +
        `Se você reconhece e autorizou este pedido, nenhuma ação é necessária. Se você NÃO esperava esta mensagem, contate ` +
        `imediatamente o administrador da sua unidade antes que a troca seja confirmada — sua conta pode estar sendo alvo de uma tentativa de sequestro.`,
    };
  },
};
