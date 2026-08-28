import { zValidator as honoZValidator } from "@hono/zod-validator";
import type { Env, ValidationTargets } from "hono";
import type { ZodSchema, z } from "zod";
import { baseLogger } from "./logger";

// Achado real de produção (2026-08-27, usuário armeiro): uma solicitação de
// adição de material com foto falhava com 400 ZodError, e NENHUM lugar da
// observabilidade "premium" (Pino + requestId + audit_logs, ver
// docs/enterprise/specs/observability-logging-enterprise.md) registrou o
// evento — nem stdout, nem audit_logs. Causa: `@hono/zod-validator` sem um
// `hook` responde 400 direto pro cliente, sem passar pelo logger, pelo
// `onError` nem pelo audit_logs. Confirmado: as ~86 chamadas de zValidator
// em apps/bff/src/routes/*.ts não passavam hook nenhum.
//
// Wrapper DROP-IN — mesma assinatura de 2 argumentos (target, schema) que
// todo call site já usa — só troca o import, nenhuma outra linha muda. O
// hook abaixo só ADICIONA um log em falha; nunca altera o body/status da
// resposta que o cliente recebe (mesmo comportamento de antes).
//
// REP10 (nunca logar segredo/PII cru): `result.error.flatten().fieldErrors`
// do Zod só devolve NOMES de campo + mensagem de erro, nunca o valor
// enviado pelo cliente — payload plano, seguro por construção. Nunca trocar
// isto por `result.error.issues` bruto nem por `c.req.valid(target)` (que
// carregaria o dado original, podendo incluir senha/token/TOTP num payload
// malformado).
export function zValidator<T extends ZodSchema<any, z.ZodTypeDef, any>, Target extends keyof ValidationTargets, E extends Env, P extends string>(
  target: Target,
  schema: T,
) {
  return honoZValidator<T, Target, E, P>(target, schema, (result, c) => {
    if (result.success) return;
    const log = (c.get as (key: string) => unknown)("log") as typeof baseLogger | undefined;
    (log ?? baseLogger).warn({
      path: c.req.path,
      method: c.req.method,
      target,
      issues: result.error.flatten().fieldErrors,
    }, "validation.failure");
  });
}
