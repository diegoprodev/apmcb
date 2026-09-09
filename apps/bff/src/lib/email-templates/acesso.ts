import { z } from "zod";
import { escapeHtml } from "./_escape.ts";
import type { TemplateDef } from "./index.ts";

// E-mail de acesso — enviado quando um admin (admin_global / admin_reserva /
// armeiro) provisiona o login de um militar recém-cadastrado e marca "enviar
// e-mail de acesso". `url` é o recovery link gerado no servidor (roteia por
// /auth/callback → verifyOtp → /auth/update-password). O militar define a
// senha e cai na tela de login; a orientação de biometria vai por notificação
// in-app. Sem link fora do domínio: a URL é validada como z.string().url() e
// escapada no botão do layout.
export const acesso: TemplateDef<{ papel: string; url: string }> = {
  category: "lifecycle",
  schema: z
    .object({
      papel: z.string().min(1).max(60),
      url: z.string().url().max(600),
    })
    .strict(),
  build: (data: { papel: string; url: string }, _ctx, recipient) => {
    const nome = escapeHtml(recipient.nome || "militar");
    const papel = escapeHtml(data.papel);
    const orgao = recipient.orgao ? escapeHtml(recipient.orgao) : null;
    const ondeHtml = orgao ? ` da reserva <strong>${orgao}</strong>` : "";
    const ondeText = recipient.orgao ? ` da reserva ${recipient.orgao}` : "";
    return {
      subject: "Seu acesso ao Andrômeda",
      bodyHtml:
        `<p style="margin:0 0 12px;">Olá, ${nome}.</p>` +
        `<p style="margin:0 0 12px;">Você foi cadastrado no <strong>Andrômeda</strong>${ondeHtml}, com o perfil de <strong>${papel}</strong>.</p>` +
        `<p style="margin:0;">Use o botão abaixo para definir sua senha e ativar sua conta. O link é individual e de uso único.</p>`,
      bodyText:
        `Olá, ${recipient.nome || "militar"}.\n\n` +
        `Você foi cadastrado no Andrômeda${ondeText}, com o perfil de ${data.papel}. ` +
        `Use o link abaixo para definir sua senha e ativar sua conta. O link é individual e de uso único.`,
      cta: { label: "Definir minha senha", url: data.url },
    };
  },
};
