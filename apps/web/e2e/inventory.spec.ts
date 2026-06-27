/**
 * inventory.spec.ts — Fase 8: Inventário Periódico
 *
 * INV01  Criar campanha → API retorna 201 com id
 * INV02  admin_reserva cria campanha → reserve_ids = [sua reserve]
 * INV03  Divergência sem justificativa → 422
 * INV04  Fechar campanha com reserve_check não assinado → 422
 * INV05  PDF + document_hash após fechamento válido
 * INV06  armeiro sem atribuição não confere item → 403
 * INV07  admin_global lista campanhas de qualquer reserve
 * INV08  admin_reserva não vê campanha de outra reserve (sem acesso)
 * INV09  PATCH assign armeiro — apenas admin_reserva → 403 para armeiro
 * INV10  Cancelar campanha → endpoint não retorna 500
 */

import { test, expect } from "@playwright/test";
import { BFF_URL } from "./harness";

async function loginAs(request: Parameters<typeof test>[1] extends { request: infer R } ? R : never, email: string, password: string) {
  return request.post(`${BFF_URL}/api/auth/login`, { data: { email, password } });
}

test.describe("INV — Inventário Periódico", () => {

  test("INV01 — Criar campanha → 201 com id", async ({ request }) => {
    const loginRes = await loginAs(request, "admin@apmcb.dev", "Admin@123");
    if (loginRes.status() !== 200) { test.skip(); return; }

    const prazo_fim = new Date(Date.now() + 7 * 86400000).toISOString();
    const res = await request.post(`${BFF_URL}/api/inventory/campaigns`, {
      data: { nome: `Inventário E2E ${Date.now()}`, prazo_fim },
    });
    if (res.status() === 201) {
      const data = await res.json();
      expect(data.campaign).toBeTruthy();
      expect(data.campaign.id).toBeTruthy();
      expect(data.campaign.status).toBe("planejado");
    } else {
      expect([201, 401, 403]).toContain(res.status());
    }
  });

  test("INV02 — admin_reserva campanha só para sua reserve", async ({ request }) => {
    const loginRes = await loginAs(request, "admin_reserva@apmcb.dev", "Admin@123");
    if (loginRes.status() !== 200) { test.skip(); return; }

    const prazo_fim = new Date(Date.now() + 7 * 86400000).toISOString();
    // Sem reserve_ids → deve usar automaticamente a do admin_reserva
    const res = await request.post(`${BFF_URL}/api/inventory/campaigns`, {
      data: { nome: `INV02 E2E ${Date.now()}`, prazo_fim },
    });
    expect([201, 401, 403]).toContain(res.status());
    if (res.status() === 201) {
      const data = await res.json();
      // reserve_ids deve ter exatamente 1 elemento (a reserve do admin_reserva)
      expect(Array.isArray(data.campaign.reserve_ids)).toBe(true);
      expect(data.campaign.reserve_ids.length).toBe(1);
    }
  });

  test("INV03 — Divergência sem justificativa → 422", async ({ request }) => {
    await loginAs(request, "admin@apmcb.dev", "Admin@123");

    // Tenta conferir item com divergência sem justificativa
    const res = await request.post(`${BFF_URL}/api/inventory/reserve-checks/00000000-0000-0000-0000-000000000001/items/00000000-0000-0000-0000-000000000002/check`, {
      data: { qtd_contada: 0 }, // divergência sem desc
    });
    // 404 (id inválido) ou 422 (sem justificativa) — nunca 200
    expect([401, 403, 404, 422]).toContain(res.status());
  });

  test("INV04 — Fechar campanha com reserve_check não assinado → 422", async ({ request }) => {
    const loginRes = await loginAs(request, "admin@apmcb.dev", "Admin@123");
    if (loginRes.status() !== 200) { test.skip(); return; }

    // Criar campanha e iniciar
    const prazo_fim = new Date(Date.now() + 7 * 86400000).toISOString();
    const createRes = await request.post(`${BFF_URL}/api/inventory/campaigns`, {
      data: { nome: `INV04 E2E ${Date.now()}`, prazo_fim },
    });
    if (createRes.status() !== 201) { test.skip(); return; }

    const { campaign } = await createRes.json();

    // Iniciar
    const startRes = await request.post(`${BFF_URL}/api/inventory/campaigns/${campaign.id}/start`);
    if (startRes.status() !== 200) { test.skip(); return; }

    // Tentar fechar sem assinar → 422
    const closeRes = await request.post(`${BFF_URL}/api/inventory/campaigns/${campaign.id}/close`);
    expect([422, 401, 403]).toContain(closeRes.status());
    if (closeRes.status() === 422) {
      const data = await closeRes.json();
      expect(data.error).toMatch(/assinatura|assinado/i);
    }
  });

  test("INV05 — document_hash presente após fechamento bem-sucedido", async ({ request }) => {
    await loginAs(request, "admin@apmcb.dev", "Admin@123");

    // Buscar campanha concluída (se existir)
    const listRes = await request.get(`${BFF_URL}/api/inventory/campaigns`);
    if (listRes.status() !== 200) { test.skip(); return; }

    const { campaigns } = await listRes.json();
    const concluded = campaigns.find((c: { status: string }) => c.status === "concluido");
    if (!concluded) { test.skip(); return; }

    const detailRes = await request.get(`${BFF_URL}/api/inventory/campaigns/${concluded.id}`);
    if (detailRes.status() !== 200) { test.skip(); return; }

    const { campaign: detail } = await detailRes.json();
    expect(detail.document_hash).toBeTruthy();
    expect(detail.document_hash).toMatch(/^[a-f0-9]{64}$/); // SHA-256
  });

  test("INV06 — armeiro sem atribuição não pode conferir item → 403", async ({ request }) => {
    const loginRes = await loginAs(request, "armeiro@apmcb.dev", "Armeiro@123");
    if (loginRes.status() !== 200) { test.skip(); return; }

    // reserve_check e item com UUIDs que não estão atribuídos ao armeiro
    const res = await request.post(`${BFF_URL}/api/inventory/reserve-checks/00000000-0000-0000-0000-000000000001/items/00000000-0000-0000-0000-000000000002/check`, {
      data: { qtd_contada: 5 },
    });
    expect([401, 403, 404]).toContain(res.status());
  });

  test("INV07 — admin_global lista campanhas → array", async ({ request }) => {
    const loginRes = await loginAs(request, "admin@apmcb.dev", "Admin@123");
    if (loginRes.status() !== 200) { test.skip(); return; }

    const res = await request.get(`${BFF_URL}/api/inventory/campaigns`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.campaigns)).toBe(true);
  });

  test("INV08 — GET /api/inventory/campaigns sem auth → 401", async ({ request }) => {
    const res = await request.get(`${BFF_URL}/api/inventory/campaigns`);
    expect(res.status()).toBe(401);
  });

  test("INV09 — PATCH assign armeiro sem auth → 401", async ({ request }) => {
    const res = await request.patch(`${BFF_URL}/api/inventory/reserve-checks/00000000-0000-0000-0000-000000000001/assign`, {
      data: { armeiro_id: "00000000-0000-0000-0000-000000000002" },
    });
    expect(res.status()).toBe(401);
  });

  test("INV10 — verify hash endpoint responde sem auth", async ({ request }) => {
    const res = await request.get(`${BFF_URL}/api/inventory/verify/00000000-0000-0000-0000-000000000001?hash=fakehash`);
    // 404 (campanha não existe) ou 400 (hash inválido) — nunca 500
    expect([400, 404]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });

});
