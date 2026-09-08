import { escapeHtml } from "./_escape.ts";

// Layout único dos e-mails transacionais do Andrômeda. Identidade visual da
// logo: gradiente teal (profundo → claro), fundo quase-branco, tipografia
// sóbria. Padrão enterprise (coluna 600px, logo hospedada no topo, 1 CTA de
// verdade, rodapé discreto). CSS inline em tudo que importa; um <style> mínimo
// só para :hover do botão e dark-mode (clientes que ignoram caem no inline).
// A versão text/plain sozinha comunica tudo.

const TEAL_DARK = "#0B3D40";
const TEAL = "#12857E";
const TEAL_BRIGHT = "#2FC7B8";
const INK = "#0f172a";
const BODY = "#334155";
const MUTED = "#64748b";
const HAIRLINE = "#e2e8f0";
const CANVAS = "#eef2f4";

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export interface LayoutCta {
  label: string;
  /** URL absoluta, sempre no domínio do sistema (montada pelo template). */
  url: string;
}

export interface LayoutInput {
  baseUrl: string;
  /** Mantido por compat; o layout usa a logo hospedada em `${baseUrl}/images`. */
  logoDataUri?: string;
  title: string;
  preheader: string;
  /** HTML já escapado/seguro do corpo (parágrafos). */
  bodyHtml: string;
  /** Texto plano do corpo — o e-mail tem que fazer sentido só com isto. */
  bodyText: string;
  /** Botão de ação. Omitir para e-mails sem link (ex: aviso de senha alterada). */
  cta?: LayoutCta;
}

export interface RenderedBody {
  html: string;
  text: string;
}

const FOOTER_LINE = "Mensagem automática — não responda a este e-mail.";
const FOOTER_SUB =
  "Andrômeda · Controle de Bens Sensíveis. Em caso de dúvida, procure o administrador da sua unidade.";

function ctaButton(cta: LayoutCta): string {
  const url = escapeHtml(cta.url);
  const label = escapeHtml(cta.label);
  // Botão table-based (Outlook-safe). background-color é o fallback; a imagem
  // de gradiente é ignorada onde não suportada. .btn:hover vem do <style>.
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 8px;">
  <tr><td align="center" bgcolor="${TEAL}" style="border-radius:8px;background-color:${TEAL};background-image:linear-gradient(135deg,${TEAL_DARK},${TEAL} 60%,${TEAL_BRIGHT});">
    <a class="btn" href="${url}" target="_blank" rel="noopener noreferrer"
       style="display:inline-block;padding:14px 34px;font-family:${FONT};font-size:15px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:8px;">
      ${label}
    </a>
  </td></tr>
</table>`;
}

export function layout(input: LayoutInput): RenderedBody {
  const { baseUrl, title, preheader, bodyHtml, bodyText, cta } = input;
  const logo = `${baseUrl.replace(/\/$/, "")}/images/andromeda-email.png`;

  const head = `<style>
  .btn:hover{background-color:${TEAL_DARK}!important;box-shadow:0 6px 18px rgba(18,133,126,.38);}
  @media (prefers-color-scheme:dark){
    .bg{background:#0b1220!important;}
    .card{background:#111a2b!important;border-color:#1e2b40!important;}
    .ink{color:#e8eef6!important;}
    .body{color:#c2cede!important;}
    .muted{color:#8ea0b8!important;}
    .rule{border-color:#1e2b40!important;}
  }
  @media (max-width:620px){
    .card{width:100%!important;}
    .pad{padding-left:24px!important;padding-right:24px!important;}
  }
</style>`;

  const html = `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escapeHtml(title)}</title>${head}</head>
<body class="bg" style="margin:0;padding:0;background:${CANVAS};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheader)}</div>
<table role="presentation" class="bg" width="100%" cellpadding="0" cellspacing="0" style="background:${CANVAS};">
<tr><td align="center" style="padding:36px 16px;">

<table role="presentation" class="card" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid ${HAIRLINE};border-radius:14px;overflow:hidden;">

<tr><td align="center" class="pad" style="padding:36px 40px 20px;">
  <img src="${escapeHtml(logo)}" width="196" height="119" alt="Andrômeda — Controle de Bens Sensíveis" style="display:block;border:0;width:196px;height:auto;">
</td></tr>
<tr><td style="padding:0 40px;"><div style="height:3px;border-radius:2px;background-image:linear-gradient(90deg,${TEAL_DARK},${TEAL},${TEAL_BRIGHT});"></div></td></tr>

<tr><td class="pad" style="padding:30px 40px 8px;font-family:${FONT};text-align:left;">
  <h1 class="ink" style="margin:0;font-size:21px;line-height:1.35;font-weight:700;color:${INK};letter-spacing:-.01em;">${escapeHtml(title)}</h1>
</td></tr>
<tr><td class="pad body" style="padding:14px 40px 6px;font-family:${FONT};font-size:15px;line-height:1.65;color:${BODY};text-align:left;">
${bodyHtml}
${cta ? ctaButton(cta) : ""}
</td></tr>

<tr><td class="pad" style="padding:26px 40px 0;"><div class="rule" style="border-top:1px solid ${HAIRLINE};"></div></td></tr>
<tr><td class="pad muted" style="padding:18px 40px 34px;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED};text-align:left;">
  <strong style="color:${MUTED};">${FOOTER_LINE}</strong><br>${FOOTER_SUB}
</td></tr>

</table>

<div style="font-family:${FONT};font-size:11px;color:${MUTED};padding:18px 8px 0;">Andrômeda</div>

</td></tr>
</table>
</body>
</html>`;

  const parts = [
    bodyText.trim(),
    ...(cta ? ["", `${cta.label}: ${cta.url}`] : []),
    "",
    "—",
    FOOTER_LINE,
    FOOTER_SUB,
  ];
  return { html, text: parts.join("\n") };
}
