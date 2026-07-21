import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { deriveTenantTemplateKey } from "../lib/biometric-template-key.ts";

describe("deriveTenantTemplateKey", () => {
  const originalKey = process.env.BIOMETRIC_TEMPLATE_MASTER_KEY;

  before(() => {
    process.env.BIOMETRIC_TEMPLATE_MASTER_KEY = "test-only-master-key-nao-usar-em-producao";
  });

  after(() => {
    if (originalKey === undefined) delete process.env.BIOMETRIC_TEMPLATE_MASTER_KEY;
    else process.env.BIOMETRIC_TEMPLATE_MASTER_KEY = originalKey;
  });

  it("é determinístico — mesmo tenant_id sempre deriva a mesma chave", async () => {
    const tenantId = "11111111-1111-1111-1111-111111111111";
    const a = await deriveTenantTemplateKey(tenantId);
    const b = await deriveTenantTemplateKey(tenantId);
    assert.equal(a, b);
  });

  it("isola tenants — tenant_id diferente deriva chave diferente", async () => {
    const a = await deriveTenantTemplateKey("11111111-1111-1111-1111-111111111111");
    const b = await deriveTenantTemplateKey("22222222-2222-2222-2222-222222222222");
    assert.notEqual(a, b);
  });

  it("deriva 32 bytes (AES-256-GCM)", async () => {
    const key = await deriveTenantTemplateKey("11111111-1111-1111-1111-111111111111");
    assert.equal(Buffer.from(key, "base64").length, 32);
  });

  it("sem BIOMETRIC_TEMPLATE_MASTER_KEY, rejeita explicitamente (fail-closed)", async () => {
    delete process.env.BIOMETRIC_TEMPLATE_MASTER_KEY;
    await assert.rejects(
      () => deriveTenantTemplateKey("11111111-1111-1111-1111-111111111111"),
      /BIOMETRIC_TEMPLATE_MASTER_KEY/,
    );
    process.env.BIOMETRIC_TEMPLATE_MASTER_KEY = "test-only-master-key-nao-usar-em-producao";
  });
});
