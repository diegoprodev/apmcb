# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ssa-totp.spec.ts >> ST — TOTP Setup & Display >> ST01 - cadete sem TOTP vê botão de configuração no dashboard
- Location: e2e\ssa-totp.spec.ts:20:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText(/configurar código/i)
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByText(/configurar código/i)

```

```yaml
- complementary:
  - img "APMCB"
  - text: APMCB
  - button
  - navigation:
    - link "Meus Materiais":
      - /url: /cadete
    - link "Histórico":
      - /url: /cadete/historico
    - link "Meu Perfil":
      - /url: /cadete/perfil
- banner:
  - button "Notificações": 9+
  - button "Alternar tema"
  - button "CA"
- main:
  - alert:
    - paragraph: Biometria não cadastrada
    - text: Compareça ao armeiro para registrar sua impressão digital. Sem biometria, apenas o código TOTP libera retirada presencial.
  - heading "Olá, Cadete" [level=2]
  - paragraph: Acompanhe seus materiais em uso
  - button "Requisitar Armamento":
    - button "Requisitar Armamento"
  - paragraph: "0"
  - paragraph: Em uso
  - paragraph: "1"
  - paragraph: Histórico
  - paragraph: "1"
  - paragraph: Devolvidos
  - button "Código de Acesso Alternativa à biometria ▲":
    - paragraph: Código de Acesso
    - paragraph: Alternativa à biometria
    - text: ▲
  - text: Erro ao obter código.
  - heading "Solicitações de Armamento" [level=3]
  - link "Ver todas":
    - /url: /cadete/solicitacoes
  - 'link "Não aprovado Espadim ×1 Solicitado em 15 de jun. às 20:41 Motivo: Material em manutenção preventiva agendada #0409524E"':
    - /url: /cadete/solicitacoes
    - text: Não aprovado
    - paragraph: Espadim ×1
    - paragraph: Solicitado em 15 de jun. às 20:41
    - text: "Motivo: Material em manutenção preventiva agendada"
    - paragraph: "#0409524E"
  - 'link "Cancelado Espadim ×1 Solicitado em 15 de jun. às 20:41 #F60457AD"':
    - /url: /cadete/solicitacoes
    - text: Cancelado
    - paragraph: Espadim ×1
    - paragraph: Solicitado em 15 de jun. às 20:41
    - paragraph: "#F60457AD"
  - 'link "Cancelado Espadim ×1 Solicitado em 15 de jun. às 20:41 #944E7252"':
    - /url: /cadete/solicitacoes
    - text: Cancelado
    - paragraph: Espadim ×1
    - paragraph: Solicitado em 15 de jun. às 20:41
    - paragraph: "#944E7252"
  - paragraph: Nenhum material em uso
  - paragraph: Toque em "Requisitar Armamento" para solicitar materiais
- region "Notifications alt+T"
- alert
```

# Test source

```ts
  1   | /**
  2   |  * SSA TOTP Spec — ST01–ST15
  3   |  *
  4   |  * Tests TOTP setup, code generation, armeiro validation,
  5   |  * rate limiting, and security (secret never exposed).
  6   |  *
  7   |  * Run:
  8   |  *   npx playwright test ssa-totp.spec.ts --project=ssa-suite
  9   |  */
  10  | 
  11  | import { test, expect } from "@playwright/test";
  12  | import { BASE_URL, BFF_URL, login } from "./harness";
  13  | import {
  14  |   bffCall, setupTOTP, getTOTPCode, resetTOTPFailures,
  15  | } from "./harness/ssa";
  16  | 
  17  | test.describe("ST — TOTP Setup & Display", () => {
  18  | 
  19  |   // ── ST01 ──────────────────────────────────────────────────────────────────
  20  |   test("ST01 - cadete sem TOTP vê botão de configuração no dashboard", async ({ page }) => {
  21  |     await login(page, "cadete");
  22  |     // Fresh cadete: TOTP not configured, setup card shown
  23  |     await page.goto(`${BASE_URL}/cadete`);
> 24  |     await expect(page.getByText(/configurar código/i)).toBeVisible({ timeout: 10_000 });
      |                                                        ^ Error: expect(locator).toBeVisible() failed
  25  |   });
  26  | 
  27  |   // ── ST02 ──────────────────────────────────────────────────────────────────
  28  |   test("ST02 - POST /api/totp/setup retorna 401 sem autenticação", async ({ page }) => {
  29  |     const res = await page.request.post(`${BFF_URL}/api/totp/setup`);
  30  |     expect(res.status()).toBe(401);
  31  |   });
  32  | 
  33  |   // ── ST03 ──────────────────────────────────────────────────────────────────
  34  |   test("ST03 - POST /api/totp/setup retorna 200 para cadete e nunca expõe secret", async ({ page }) => {
  35  |     await login(page, "cadete");
  36  |     const { status, data } = await bffCall(page, "POST", "/api/totp/setup");
  37  |     expect(status).toBe(200);
  38  |     expect((data as Record<string, unknown>).ok).toBe(true);
  39  |     expect(JSON.stringify(data)).not.toMatch(/secret/i);
  40  |   });
  41  | 
  42  |   // ── ST04 ──────────────────────────────────────────────────────────────────
  43  |   test("ST04 - GET /api/totp/status retorna { configured: true } após setup", async ({ page }) => {
  44  |     await login(page, "cadete");
  45  |     await bffCall(page, "POST", "/api/totp/setup");
  46  |     const { status, data } = await bffCall(page, "GET", "/api/totp/status");
  47  |     expect(status).toBe(200);
  48  |     expect((data as { configured: boolean }).configured).toBe(true);
  49  |   });
  50  | 
  51  |   // ── ST05 ──────────────────────────────────────────────────────────────────
  52  |   test("ST05 - GET /api/totp/code retorna 6 dígitos + seconds_remaining válido", async ({ page }) => {
  53  |     await login(page, "cadete");
  54  |     await bffCall(page, "POST", "/api/totp/setup");
  55  |     const { status, data } = await bffCall(page, "GET", "/api/totp/code");
  56  |     const body = data as { code: string; seconds_remaining: number; period: number };
  57  |     expect(status).toBe(200);
  58  |     expect(body.code).toMatch(/^\d{6}$/);
  59  |     expect(body.seconds_remaining).toBeGreaterThanOrEqual(1);
  60  |     expect(body.seconds_remaining).toBeLessThanOrEqual(30);
  61  |     expect(body.period).toBe(30);
  62  |   });
  63  | 
  64  |   // ── ST06 ──────────────────────────────────────────────────────────────────
  65  |   test("ST06 - GET /api/totp/code retorna 401 sem autenticação", async ({ page }) => {
  66  |     const res = await page.request.get(`${BFF_URL}/api/totp/code`);
  67  |     expect(res.status()).toBe(401);
  68  |   });
  69  | 
  70  |   // ── ST07 ──────────────────────────────────────────────────────────────────
  71  |   test("ST07 - TOTPDisplay aparece no dashboard cadete após configuração", async ({ page }) => {
  72  |     await login(page, "cadete");
  73  |     await bffCall(page, "POST", "/api/totp/setup");
  74  |     await page.goto(`${BASE_URL}/cadete`);
  75  |     const display = page.getByTestId("totp-display");
  76  |     await expect(display).toBeVisible({ timeout: 10_000 });
  77  |     const code = (await display.textContent())?.replace(/\D/g, "") ?? "";
  78  |     expect(code).toMatch(/^\d{6}$/);
  79  |   });
  80  | 
  81  |   // ── ST08 ──────────────────────────────────────────────────────────────────
  82  |   test("ST08 - POST /api/totp/validate rejeita código errado (retorna valid: false)", async ({ page }) => {
  83  |     await login(page, "cadete");
  84  |     await setupTOTP(page);
  85  |     const cadeteId = await (await bffCall(page, "GET", "/api/totp/status")).data;
  86  |     // Switch to armeiro to call validate
  87  |     await login(page, "armeiro");
  88  |     const cadeteMatricula = "000003";
  89  |     const { data: lookupData } = await bffCall(page, "GET", `/api/ssa/lookup-military?matricula=${cadeteMatricula}`);
  90  |     const militaryId = (lookupData as { id: string }).id;
  91  | 
  92  |     const { status, data } = await bffCall(page, "POST", "/api/totp/validate", {
  93  |       military_id: militaryId,
  94  |       token: "000000",
  95  |     });
  96  |     expect(status).toBe(200);
  97  |     expect((data as { valid: boolean }).valid).toBe(false);
  98  |   });
  99  | 
  100 |   // ── ST09 ──────────────────────────────────────────────────────────────────
  101 |   test("ST09 - POST /api/totp/validate aceita código correto e retorna dados do militar", async ({ page }) => {
  102 |     await login(page, "cadete");
  103 |     await setupTOTP(page);
  104 |     const code = await getTOTPCode(page);
  105 | 
  106 |     await login(page, "armeiro");
  107 |     const { data: lookupData } = await bffCall(page, "GET", `/api/ssa/lookup-military?matricula=000003`);
  108 |     const militaryId = (lookupData as { id: string }).id;
  109 | 
  110 |     const { status, data } = await bffCall(page, "POST", "/api/totp/validate", {
  111 |       military_id: militaryId,
  112 |       token: code,
  113 |     });
  114 |     expect(status).toBe(200);
  115 |     const body = data as { valid: boolean; military_nome: string; military_posto: string; military_matricula: string };
  116 |     expect(body.valid).toBe(true);
  117 |     expect(body.military_nome).toBeTruthy();
  118 |     expect(body.military_matricula).toBe("000003");
  119 |   });
  120 | 
  121 |   // ── ST10 ──────────────────────────────────────────────────────────────────
  122 |   test("ST10 - cadete não pode chamar /api/totp/validate (role=military → 403)", async ({ page }) => {
  123 |     await login(page, "cadete");
  124 |     await setupTOTP(page);
```