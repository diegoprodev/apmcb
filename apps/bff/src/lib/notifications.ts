import { supabase } from "../services/supabase";
import { logger } from "./logger";

// Extraído de arsenal.ts (achado de code review ao adicionar o mesmo padrão
// em categories.ts — duplicar esta função violaria DRY/SSOT). Fire-and-forget
// por design (não deve bloquear a resposta HTTP do caller), mas uma falha de
// insert não pode ficar muda — achado real documentado em
// 20260814120100_add_arsenal_notification_types.sql: types que não existem em
// notification_type_enum fazem o INSERT falhar em silêncio quando o caller
// não checa `{ error }`.
export async function insertNotifications(
  rows: { user_id: string; type: string; title: string; body: string; metadata: Record<string, unknown> }[],
  logTag: string,
  logFields: Record<string, unknown> = {}
) {
  if (rows.length === 0) return;
  // try/catch em volta do próprio await, não só checagem de `{ error }`:
  // achado de code review — o comentário acima promete "fire-and-forget...
  // não deve bloquear a resposta HTTP do caller", mas se o client do Supabase
  // REJEITAR a promise (exceção de rede/timeout, distinto de resolver com
  // `{ error }` preenchido) essa exceção propagava pro caller sem ser pega,
  // transformando uma operação de negócio já bem-sucedida (categoria
  // aprovada, solicitação criada, etc.) num 500 pro usuário só porque o
  // aviso — que é best-effort por design — falhou ao nível de transporte.
  try {
    const { error } = await supabase.from("notifications").insert(rows);
    if (error) {
      logger.error(logTag, { ...logFields, error: error.message });
    }
  } catch (err) {
    logger.error(logTag, { ...logFields, error: err instanceof Error ? err.message : String(err) });
  }
}
