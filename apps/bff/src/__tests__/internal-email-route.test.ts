import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { templateCategory, TEMPLATE_IDS } from "../lib/email-templates/index.ts";

// Réplica de mecanismo das decisões próprias de routes/internal.ts. O handler
// real (buildDeps + handleEmailRequest, com supabase monkey-patched) é coberto
// por __tests__/internal-email-handler.test.ts. Aqui fica só a lógica pura de
// validação/categoria, que CI roda sem env de banco.

// Cópia fiel do schema em routes/internal.ts:
const bodySchema = z.object({
  template: z.string().min(1).max(64),
  recipient_id: z.string().uuid(),
  data: z.record(z.unknown()).default({}),
  category: z.enum(["security", "lifecycle"]).optional(),
});

const UUID = "11111111-1111-1111-1111-111111111111";

describe("routes/internal — validação de body", () => {
  it("aceita payload mínimo válido, aplica default de data", () => {
    const r = bodySchema.safeParse({ template: "canary", recipient_id: UUID });
    assert.equal(r.success, true);
    assert.deepEqual(r.data!.data, {});
  });

  it("rejeita recipient_id não-uuid", () => {
    assert.equal(bodySchema.safeParse({ template: "canary", recipient_id: "abc" }).success, false);
  });

  it("rejeita template vazio e template > 64 chars", () => {
    assert.equal(bodySchema.safeParse({ template: "", recipient_id: UUID }).success, false);
    assert.equal(bodySchema.safeParse({ template: "x".repeat(65), recipient_id: UUID }).success, false);
  });

  it("rejeita category fora do enum", () => {
    assert.equal(bodySchema.safeParse({ template: "canary", recipient_id: UUID, category: "spam" }).success, false);
  });
});

describe("routes/internal — resolução de categoria", () => {
  // resolve = templateCategory(template) ?? body.category ?? "lifecycle"
  const resolve = (template: string, bodyCategory?: "security" | "lifecycle") =>
    templateCategory(template) ?? bodyCategory ?? "lifecycle";

  it("categoria do REGISTRY vence a do body (caller não pode escalar canary p/ security)", () => {
    assert.equal(resolve("canary", "security"), "lifecycle");
  });

  it("template desconhecido cai no body.category, senão lifecycle", () => {
    assert.equal(resolve("nao_existe", "security"), "security");
    assert.equal(resolve("nao_existe", undefined), "lifecycle");
  });

  it("todo template registrado tem categoria conhecida", () => {
    for (const id of TEMPLATE_IDS) {
      assert.ok(["security", "lifecycle"].includes(templateCategory(id)!), id);
    }
  });
});
