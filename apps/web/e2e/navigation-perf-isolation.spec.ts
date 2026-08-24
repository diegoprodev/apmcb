/**
 * APMCB — PERF-02 per-request identity isolation (spec §8, mandatory,
 * duas variantes: concorrente e sequencial)
 *
 * getSessionUser()/getSessionProfile() (apps/web/src/lib/session-profile.ts)
 * memoizam via React cache() — escopado por request pelo dispatcher do
 * Next.js. O precedente citado na spec §4 ((dashboard)/layout.tsx:2-6, o
 * incidente de session-bleed original) mostrou que uma leitura de identidade
 * pode vazar entre requests quando um isolate/worker é reaproveitado — o
 * modo de falha mais próximo aqui não é disputa de concorrência pura, é
 * isolate morno reaproveitado entre requests SEQUENCIAIS de usuários
 * diferentes. Por isso as duas variantes abaixo, não só uma.
 *
 * IMPORTANTE — natureza deste teste: `next dev` roda em processo Node único,
 * sem múltiplos isolates/workers — não é capaz de reproduzir OU refutar esse
 * modo de falha. Este arquivo só tem sinal real contra o ambiente do
 * adaptador de verdade (deploy de preview do Cloudflare Pages ou staging):
 *
 *   E2E_BASE_URL=https://<preview>.apmcb.pages.dev npx playwright test \
 *     e2e/navigation-perf-isolation.spec.ts --project=navigation-perf-isolation-suite
 *
 * Contra `next dev`/localhost isso PASSA trivialmente (não há isolate pra
 * vazar) — um "passou" aqui não é evidência de nada. Critério de bloqueio
 * da spec (§8): PERF-02 não é considerado concluído sem as duas variantes
 * passando no ambiente REAL E o monitoramento de produção (log estruturado
 * comparando userId resolvido por getSessionUser() contra x-verified-user-id)
 * configurado nos primeiros 7 dias pós-deploy — este arquivo cobre só a
 * metade automatizável.
 *
 * Usa dois usuários REAIS diferentes com acesso a reserva/arsenal (armeiro e
 * admin_reserva) — não dá pra usar dois "armeiro" porque só existe 1 fixture
 * por role no harness.
 */

import { test, expect, type Page } from "@playwright/test";
import { BASE_URL, login } from "./helpers";

async function readOwnName(page: Page): Promise<string> {
  // Header tooltip do avatar — texto cru de `userName` (header.tsx), sempre
  // presente no DOM independente de hover (opacity-0, não display:none).
  const tooltip = page.locator("span").filter({ hasText: /.+/ }).last();
  // Mais confiável: pega o texto de QUALQUER span dentro do dropdown trigger
  // group — mas pra evitar acoplamento a estrutura interna, usa o título do
  // avatar (atributo `title` do Radix Avatar.Fallback, ou o texto do tooltip).
  const nameSpan = page.locator('[class*="group/avatar"] span', { hasText: /\S/ });
  const text = (await nameSpan.first().textContent().catch(() => null)) ?? (await tooltip.textContent());
  return (text ?? "").trim();
}

test.describe("PERF-02 — isolamento de identidade por request em reserva/arsenal (mandatório, requer ambiente real)", () => {
  test("(a) concorrente — duas abas simultâneas de usuários diferentes nunca veem o nome uma da outra", async ({
    browser,
  }) => {
    const ctxArmeiro = await browser.newContext();
    const ctxAdminReserva = await browser.newContext();
    const pageArmeiro = await ctxArmeiro.newPage();
    const pageAdminReserva = await ctxAdminReserva.newPage();

    await Promise.all([login(pageArmeiro, "reserva"), login(pageAdminReserva, "adminReserva")]);

    await Promise.all([
      pageArmeiro.goto(`${BASE_URL}/reserva/arsenal`, { waitUntil: "load" }),
      pageAdminReserva.goto(`${BASE_URL}/reserva/arsenal`, { waitUntil: "load" }),
    ]);

    const [nameArmeiro, nameAdminReserva] = await Promise.all([
      readOwnName(pageArmeiro),
      readOwnName(pageAdminReserva),
    ]);

    expect(nameArmeiro.length).toBeGreaterThan(0);
    expect(nameAdminReserva.length).toBeGreaterThan(0);
    expect(
      nameArmeiro,
      "usuário armeiro viu o nome do admin_reserva na própria sessão — vazamento de identidade entre requests concorrentes",
    ).not.toBe(nameAdminReserva);

    await ctxArmeiro.close();
    await ctxAdminReserva.close();
  });

  test("(b) sequencial repetido — requests alternados de usuários diferentes nunca herdam identidade do request anterior (isolate morno)", async ({
    browser,
  }) => {
    const ctxArmeiro = await browser.newContext();
    const ctxAdminReserva = await browser.newContext();
    const pageArmeiro = await ctxArmeiro.newPage();
    const pageAdminReserva = await ctxAdminReserva.newPage();

    await login(pageArmeiro, "reserva");
    await login(pageAdminReserva, "adminReserva");

    // Repete o suficiente pra aumentar a chance de reuso de isolate no
    // ambiente real — natureza probabilística reconhecida na spec §8: um
    // "passou" é evidência, não prova formal de ausência do bug.
    for (let i = 0; i < 8; i++) {
      await pageArmeiro.goto(`${BASE_URL}/reserva/arsenal`, { waitUntil: "load" });
      const nameArmeiro = await readOwnName(pageArmeiro);

      await pageAdminReserva.goto(`${BASE_URL}/reserva/arsenal`, { waitUntil: "load" });
      const nameAdminReserva = await readOwnName(pageAdminReserva);

      expect(nameArmeiro.length, `iteração ${i}: nome do armeiro vazio`).toBeGreaterThan(0);
      expect(nameAdminReserva.length, `iteração ${i}: nome do admin_reserva vazio`).toBeGreaterThan(0);
      expect(
        nameArmeiro,
        `iteração ${i}: armeiro herdou o nome do admin_reserva do request sequencial anterior — isolate reaproveitado com identidade errada`,
      ).not.toBe(nameAdminReserva);
    }

    await ctxArmeiro.close();
    await ctxAdminReserva.close();
  });
});
