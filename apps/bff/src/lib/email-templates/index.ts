import type { z } from "zod";
import { layout } from "./_layout.ts";
import { sanitizeField } from "./_escape.ts";
import { canary } from "./canary.ts";

export type EmailCategory = "security" | "lifecycle";

export interface TemplateCtx {
  baseUrl: string;
  logoDataUri: string;
}

// Campos derivados do lookup server-side (nunca do payload do caller) —
// passados separados do `data` validado para não colidir com o `.strict()`
// dos schemas.
export interface RecipientFields {
  nome: string;
  orgao: string | null;
}

export interface BuiltBody {
  subject: string;
  /** HTML do corpo — o `build` já chamou escapeHtml em cada campo livre. */
  bodyHtml: string;
  bodyText: string;
}

export interface TemplateDef<T> {
  category: EmailCategory;
  schema: z.ZodType<T>;
  build: (data: T, ctx: TemplateCtx, recipient: RecipientFields) => BuiltBody;
}

// Registry — cada fase adiciona seu template aqui.
const TEMPLATES = {
  canary,
} as const;

export type TemplateId = keyof typeof TEMPLATES;
export const TEMPLATE_IDS = Object.keys(TEMPLATES) as TemplateId[];

export function templateCategory(id: string): EmailCategory | null {
  return Object.hasOwn(TEMPLATES, id)
    ? (TEMPLATES as Record<string, TemplateDef<unknown>>)[id].category
    : null;
}

/** Valida `data` contra o schema do template. Uso: orquestrador (400 + log). */
export function validateTemplateData(id: string, data: unknown) {
  // Object.hasOwn — não `in` — para não casar "constructor"/"__proto__"/
  // "toString" via cadeia de protótipo (key confusion → TypeError → 500).
  if (!Object.hasOwn(TEMPLATES, id)) return { ok: false as const, error: "unknown_template" };
  const def = (TEMPLATES as Record<string, TemplateDef<unknown>>)[id];
  const parsed = def.schema.safeParse(data);
  if (!parsed.success) {
    return { ok: false as const, error: "invalid_data", issues: parsed.error.flatten().fieldErrors };
  }
  return { ok: true as const, data: parsed.data };
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const NO_RECIPIENT: RecipientFields = { nome: "", orgao: null };

export function renderTemplate(
  id: string,
  data: unknown,
  ctx: TemplateCtx,
  recipient: RecipientFields = NO_RECIPIENT,
): RenderedEmail {
  if (!Object.hasOwn(TEMPLATES, id)) throw new Error(`template desconhecido: ${id}`);
  const def = (TEMPLATES as Record<string, TemplateDef<unknown>>)[id];

  // Re-valida (defensivo — o orquestrador já validou) e sanitiza todo campo
  // string antes de qualquer interpolação. `sanitizeField` só remove control
  // chars + trunca — NÃO escapa HTML. Escape de HTML é responsabilidade do
  // `build` de cada template (que chama escapeHtml em cada campo que entra no
  // bodyHtml). Não há tratamento especial para campos `*_html`: quando um
  // template precisar de HTML rico vindo do caller (nenhum precisa hoje), a
  // sanitização tem que ser com allowlist, não aqui.
  const parsed = def.schema.parse(data) as Record<string, unknown>;
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed)) {
    clean[k] = typeof v === "string" ? sanitizeField(v, 500) : v;
  }
  const cleanRecipient: RecipientFields = {
    nome: sanitizeField(recipient.nome, 80),
    orgao: recipient.orgao == null ? null : sanitizeField(recipient.orgao, 120),
  };

  const built = def.build(clean, ctx, cleanRecipient);
  const { html, text } = layout({
    baseUrl: ctx.baseUrl,
    logoDataUri: ctx.logoDataUri,
    title: sanitizeField(built.subject, 160),
    preheader: sanitizeField(built.bodyText.split("\n")[0] ?? "", 140),
    bodyHtml: built.bodyHtml,
    bodyText: built.bodyText,
  });

  return { subject: sanitizeField(built.subject, 160), html, text };
}
