// Parsing do corpo de erro da Admin API do GoTrue (Supabase Auth).
//
// O corpo usa `msg` e `error_code` (às vezes `code`), NÃO `message` — ler
// `err.message` devolvia sempre `undefined` e o chamador caía num fallback
// genérico. Além disso o corpo nem sempre é JSON.
//
// `isDuplicate`: e-mail/usuário já registrado. No /api/admin/militares o e-mail
// enviado ao GoTrue é sintético (`${matricula}.interno@apmcb.sistema`), então
// "duplicado" ali significa "matrícula já cadastrada".

export interface ClassifiedGotrueError {
  /** Trecho legível do erro (capado em 200 chars), para log. */
  detail: string;
  /** `error_code`/`code` do GoTrue, quando presente. */
  code?: string;
  /** e-mail/usuário já existe. */
  isDuplicate: boolean;
}

export function classifyGotrueError(rawBody: string): ClassifiedGotrueError {
  let parsed: { msg?: string; message?: string; error_code?: string; code?: unknown } = {};
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    /* corpo não-JSON — usa o texto cru */
  }

  const detail = (parsed.msg ?? parsed.message ?? rawBody ?? "").slice(0, 200);
  const code =
    parsed.error_code ??
    (typeof parsed.code === "string" ? parsed.code : undefined);

  const isDuplicate =
    code === "email_exists" ||
    code === "user_already_exists" ||
    /already .*regist/i.test(detail);

  return { detail, code, isDuplicate };
}
