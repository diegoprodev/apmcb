import { z } from "zod";
import { escapeHtml } from "./_escape.ts";
import type { TemplateDef } from "./index.ts";

// Fase 3 — alerta de novo acesso. Categoria `security`: nunca silenciado sob
// throttle/cota (O7). Disparado por lib/login-device.ts quando um device_hash
// novo aparece (e não é o 1º device do usuário nem logo após a ativação).
//
// `quando` é obrigatório. `dispositivo` (ex.: "Chrome em Windows") e `ip_regiao`
// (prefixo /24 já mascarado, ex.: "191.0.0.x") são opcionais — quando o IP não
// é confiável (D17) o e-mail sai sem a dimensão de rede. O template NUNCA
// recebe nem imprime IP completo: quem chama já passa o prefixo mascarado.
// Sem link, sem token (mesma linha do password_changed).
type NewLoginData = {
  quando: string;
  dispositivo?: string;
  ip_regiao?: string;
};

export const newLogin: TemplateDef<NewLoginData> = {
  category: "security",
  schema: z
    .object({
      quando: z.string().min(1).max(60),
      dispositivo: z.string().min(1).max(80).optional(),
      ip_regiao: z.string().min(1).max(40).optional(),
    })
    .strict(),
  build: (data: NewLoginData, _ctx, recipient) => {
    const nome = escapeHtml(recipient.nome || "militar");
    const quando = escapeHtml(data.quando);

    const deHtml = data.dispositivo ? ` a partir de <strong>${escapeHtml(data.dispositivo)}</strong>` : "";
    const deText = data.dispositivo ? ` a partir de ${data.dispositivo}` : "";
    const redeHtml = data.ip_regiao ? ` (rede <strong>${escapeHtml(data.ip_regiao)}</strong>)` : "";
    const redeText = data.ip_regiao ? ` (rede ${data.ip_regiao})` : "";

    return {
      subject: "Novo acesso à sua conta Andrômeda",
      bodyHtml:
        `<p style="margin:0 0 12px;">Olá, ${nome}.</p>` +
        `<p style="margin:0 0 12px;">Registramos um acesso à sua conta no Andrômeda em <strong>${quando}</strong>${deHtml}${redeHtml}.</p>` +
        `<p style="margin:0 0 12px;">Se foi você, nenhuma ação é necessária.</p>` +
        `<p style="margin:0;">Se você não reconhece este acesso, <strong>troque a senha imediatamente</strong> e procure o administrador da sua unidade — sua conta pode estar comprometida.</p>`,
      bodyText:
        `Olá, ${recipient.nome || "militar"}.\n\n` +
        `Registramos um acesso à sua conta no Andrômeda em ${data.quando}${deText}${redeText}.\n\n` +
        `Se foi você, nenhuma ação é necessária. Se você não reconhece este acesso, ` +
        `troque a senha imediatamente e procure o administrador da sua unidade — sua conta pode estar comprometida.`,
    };
  },
};
