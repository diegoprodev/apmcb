import { escapeHtml } from "./_escape.ts";

// Layout único, institucional, minimalista (plano §3.2.1): 1 cor de marca,
// tons de cinza, alinhamento à esquerda, 600px, CSS 100% inline (clientes de
// e-mail removem <style> do <head>), sem emoji, tom seco de comunicação
// oficial. A versão text/plain sozinha comunica tudo.

const BRAND = "#1B3A8C";
const INK = "#1f2937";
const MUTED = "#6b7280";
const HAIRLINE = "#e5e7eb";
const CANVAS = "#f4f5f7";

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export interface LayoutInput {
  baseUrl: string;
  logoDataUri: string;
  title: string;
  preheader: string;
  /** HTML já escapado/seguro do corpo (parágrafos, listas). */
  bodyHtml: string;
  /** Texto plano do corpo — o e-mail tem que fazer sentido só com isto. */
  bodyText: string;
}

export interface RenderedBody {
  html: string;
  text: string;
}

function wordmark(logoDataUri: string): string {
  if (logoDataUri) {
    return `<img src="${escapeHtml(logoDataUri)}" width="120" alt="Andrômeda" style="display:block;border:0;height:auto;">`;
  }
  return `<span style="font-size:16px;font-weight:700;letter-spacing:.08em;color:${BRAND};">Andrômeda</span>`;
}

export function layout(input: LayoutInput): RenderedBody {
  const { logoDataUri, title, preheader, bodyHtml, bodyText } = input;

  const html = `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:${CANVAS};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CANVAS};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid ${HAIRLINE};">
<tr><td style="padding:24px 32px;border-bottom:1px solid ${HAIRLINE};">${wordmark(logoDataUri)}</td></tr>
<tr><td style="padding:32px;font-family:${FONT};font-size:15px;line-height:1.6;color:${INK};text-align:left;">
<h1 style="margin:0 0 16px;font-size:18px;font-weight:600;color:${INK};">${escapeHtml(title)}</h1>
${bodyHtml}
</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid ${HAIRLINE};font-family:${FONT};font-size:12px;line-height:1.5;color:${MUTED};text-align:left;">
Mensagem automática do Sistema Andrômeda. Em caso de dúvida, procure o administrador da sua unidade.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    bodyText.trim(),
    "",
    "—",
    "Mensagem automática do Sistema Andrômeda. Em caso de dúvida, procure o administrador da sua unidade.",
  ].join("\n");

  return { html, text };
}
