import { z } from "zod";
import { escapeHtml } from "./_escape.ts";
import type { TemplateDef } from "./index.ts";

// E-mail de boas-vindas (Fase 2) — enviado uma única vez, quando o militar
// define a senha e ativa a conta (POST /api/auth/update-password, guard atômico
// em profiles.welcome_email_sent_at). `nome` e `orgao` vêm do lookup
// server-side; nenhum dado do caller (schema .strict vazio). O link de acesso
// é montado do baseUrl + "/login" no build — nunca vem do `data` (anti-phishing).
//
// `orgao` no endpoint interno é o nome do TENANT (o orquestrador não resolve a
// reserva do militar) — por isso a frase é "(orgao)" entre parênteses, que lê
// bem tanto para "PMPB" quanto para o nome de uma reserva, e não "da reserva
// {orgao}" (que ficaria errado com o nome do tenant).
export const welcome: TemplateDef<Record<string, never>> = {
  category: "lifecycle",
  schema: z.object({}).strict(),
  build: (_data, ctx, recipient) => {
    const nome = escapeHtml(recipient.nome || "militar");
    const loginUrl = `${ctx.baseUrl.replace(/\/+$/, "")}/login`;
    const orgao = recipient.orgao ? escapeHtml(recipient.orgao) : null;
    const ondeHtml = orgao ? ` (<strong>${orgao}</strong>)` : "";
    const ondeText = recipient.orgao ? ` (${recipient.orgao})` : "";
    return {
      subject: "Bem-vindo ao Andrômeda",
      bodyHtml:
        `<p style="margin:0 0 12px;">Olá, ${nome}.</p>` +
        `<p style="margin:0 0 12px;">Sua conta no <strong>Andrômeda</strong>${ondeHtml} está ativa. Use o botão abaixo para entrar.</p>` +
        `<p style="margin:0;">Seu <strong>código dinâmico</strong> já está funcional — ele aparece no próprio sistema quando você precisa requisitar material. Para concluir o cadastro, dirija-se à reserva da sua unidade para o registro biométrico.</p>`,
      // text/plain: valor literal, sem escape (convenção do projeto — ver
      // acesso.ts e o teste "o text/plain é literal"). `nome` escapado só entra
      // no bodyHtml acima.
      bodyText:
        `Olá, ${recipient.nome || "militar"}.\n\n` +
        `Sua conta no Andrômeda${ondeText} está ativa. Acesse em ${loginUrl}\n\n` +
        `Seu código dinâmico já está funcional (aparece no próprio sistema). ` +
        `Para concluir o cadastro, dirija-se à reserva da sua unidade para o registro biométrico.`,
      cta: { label: "Acessar o Andrômeda", url: loginUrl },
    };
  },
};
