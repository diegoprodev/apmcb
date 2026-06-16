# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ssa-request.spec.ts >> SR — Material Request (Cadete) >> SR01 - GET /available-materials retorna lista sem campos de quantidade
- Location: e2e\ssa-request.spec.ts:25:7

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - complementary [ref=e3]:
      - generic [ref=e4]:
        - generic [ref=e5]:
          - img "APMCB" [ref=e6]
          - generic [ref=e7]: APMCB
        - button [ref=e8]:
          - img
      - navigation [ref=e9]:
        - link "Meus Materiais" [ref=e10] [cursor=pointer]:
          - /url: /cadete
          - img [ref=e11]
          - generic [ref=e15]: Meus Materiais
        - link "Histórico" [ref=e16] [cursor=pointer]:
          - /url: /cadete/historico
          - img [ref=e17]
          - generic [ref=e20]: Histórico
        - link "Meu Perfil" [ref=e21] [cursor=pointer]:
          - /url: /cadete/perfil
          - img [ref=e22]
          - generic [ref=e27]: Meu Perfil
    - generic [ref=e28]:
      - banner [ref=e29]:
        - generic [ref=e30]:
          - button "Notificações" [ref=e31]:
            - img [ref=e32]
            - generic [ref=e35]: 9+
          - button "Alternar tema" [ref=e36]:
            - img
          - button "CA" [ref=e37]:
            - generic [ref=e39]: CA
      - main [ref=e40]:
        - generic [ref=e41]:
          - alert [ref=e43]:
            - img [ref=e44]
            - generic [ref=e46]:
              - paragraph [ref=e47]: Biometria não cadastrada
              - generic [ref=e49]:
                - img [ref=e50]
                - text: Compareça ao armeiro para registrar sua impressão digital. Sem biometria, apenas o código TOTP libera retirada presencial.
          - generic [ref=e59]:
            - generic [ref=e60]:
              - heading "Olá, Cadete" [level=2] [ref=e61]
              - paragraph [ref=e62]: Acompanhe seus materiais em uso
            - button "Requisitar Armamento" [ref=e63]:
              - button "Requisitar Armamento" [ref=e64] [cursor=pointer]:
                - img
                - text: Requisitar Armamento
          - generic [ref=e65]:
            - generic [ref=e66]:
              - img [ref=e68]
              - paragraph [ref=e72]: "0"
              - paragraph [ref=e73]: Em uso
            - generic [ref=e74]:
              - img [ref=e76]
              - paragraph [ref=e79]: "1"
              - paragraph [ref=e80]: Histórico
            - generic [ref=e81]:
              - img [ref=e83]
              - paragraph [ref=e86]: "1"
              - paragraph [ref=e87]: Devolvidos
          - generic [ref=e88]:
            - button "Código de Acesso Alternativa à biometria ▲" [ref=e89]:
              - generic [ref=e90]:
                - img [ref=e92]
                - generic [ref=e94]:
                  - paragraph [ref=e95]: Código de Acesso
                  - paragraph [ref=e96]: Alternativa à biometria
              - generic [ref=e97]: ▲
            - generic [ref=e98]: Erro ao obter código.
          - generic [ref=e99]:
            - generic [ref=e100]:
              - heading "Solicitações de Armamento" [level=3] [ref=e101]
              - link "Ver todas" [ref=e102] [cursor=pointer]:
                - /url: /cadete/solicitacoes
            - 'link "Não aprovado Espadim ×1 Solicitado em 15 de jun. às 20:41 Motivo: Material em manutenção preventiva agendada #0409524E" [ref=e103] [cursor=pointer]':
              - /url: /cadete/solicitacoes
              - generic [ref=e104]:
                - img [ref=e105]
                - text: Não aprovado
              - paragraph [ref=e109]: Espadim ×1
              - generic [ref=e110]:
                - paragraph [ref=e111]: Solicitado em 15 de jun. às 20:41
                - img [ref=e112]
              - generic [ref=e114]: "Motivo: Material em manutenção preventiva agendada"
              - paragraph [ref=e115]: "#0409524E"
            - 'link "Cancelado Espadim ×1 Solicitado em 15 de jun. às 20:41 #F60457AD" [ref=e116] [cursor=pointer]':
              - /url: /cadete/solicitacoes
              - generic [ref=e117]:
                - img [ref=e118]
                - text: Cancelado
              - paragraph [ref=e121]: Espadim ×1
              - generic [ref=e122]:
                - paragraph [ref=e123]: Solicitado em 15 de jun. às 20:41
                - img [ref=e124]
              - paragraph [ref=e126]: "#F60457AD"
            - 'link "Cancelado Espadim ×1 Solicitado em 15 de jun. às 20:41 #944E7252" [ref=e127] [cursor=pointer]':
              - /url: /cadete/solicitacoes
              - generic [ref=e128]:
                - img [ref=e129]
                - text: Cancelado
              - paragraph [ref=e132]: Espadim ×1
              - generic [ref=e133]:
                - paragraph [ref=e134]: Solicitado em 15 de jun. às 20:41
                - img [ref=e135]
              - paragraph [ref=e137]: "#944E7252"
          - generic [ref=e138]:
            - img [ref=e139]
            - paragraph [ref=e143]: Nenhum material em uso
            - paragraph [ref=e144]: Toque em "Requisitar Armamento" para solicitar materiais
  - region "Notifications alt+T"
  - alert [ref=e145]
```

# Test source

```ts
  1   | /**
  2   |  * SSA Request Spec — SR01–SR20
  3   |  *
  4   |  * Tests military-side request flow (Modo B):
  5   |  * available materials, submit, 1-active limit, UI wizard, cancel.
  6   |  *
  7   |  * Run:
  8   |  *   npx playwright test ssa-request.spec.ts --project=ssa-suite
  9   |  */
  10  | 
  11  | import { test, expect } from "@playwright/test";
  12  | import { BASE_URL, BFF_URL, login } from "./harness";
  13  | import {
  14  |   bffCall, setupTOTP, getTOTPCode,
  15  |   createMaterialRequest, cleanupRequests, getFirstAvailableMaterial,
  16  | } from "./harness/ssa";
  17  | 
  18  | test.beforeEach(async () => {
  19  |   await cleanupRequests();
  20  | });
  21  | 
  22  | test.describe("SR — Material Request (Cadete)", () => {
  23  | 
  24  |   // ── SR01 ──────────────────────────────────────────────────────────────────
  25  |   test("SR01 - GET /available-materials retorna lista sem campos de quantidade", async ({ page }) => {
  26  |     await login(page, "cadete");
  27  |     const { status, data } = await bffCall(page, "GET", "/api/ssa/available-materials");
  28  |     expect(status).toBe(200);
  29  |     const items = data as Record<string, unknown>[];
  30  |     expect(Array.isArray(items)).toBe(true);
  31  |     expect(items.length).toBeGreaterThan(0);
  32  |     for (const item of items) {
  33  |       expect(item.quantidade_disponivel).toBeUndefined();
  34  |       expect(item.quantidade_total).toBeUndefined();
  35  |       expect(item.quantidade_reservada).toBeUndefined();
> 36  |       expect(item.disponivel).toBe(true);
      |                               ^ Error: expect(received).toBe(expected) // Object.is equality
  37  |     }
  38  |   });
  39  | 
  40  |   // ── SR02 ──────────────────────────────────────────────────────────────────
  41  |   test("SR02 - GET /available-materials retorna 401 sem autenticação", async ({ page }) => {
  42  |     const res = await page.request.get(`${BFF_URL}/api/ssa/available-materials`);
  43  |     expect(res.status()).toBe(401);
  44  |   });
  45  | 
  46  |   // ── SR03 ──────────────────────────────────────────────────────────────────
  47  |   test("SR03 - POST /requests retorna 400 com código TOTP errado", async ({ page }) => {
  48  |     await login(page, "cadete");
  49  |     await setupTOTP(page);
  50  |     const material = await getFirstAvailableMaterial(page);
  51  | 
  52  |     const { status, data } = await bffCall(page, "POST", "/api/ssa/requests", {
  53  |       items: [{ material_type_id: material.id, quantity: 1 }],
  54  |       totp_token: "000000",
  55  |     });
  56  |     expect(status).toBe(400);
  57  |     expect((data as { error: string }).error).toMatch(/código/i);
  58  |   });
  59  | 
  60  |   // ── SR04 ──────────────────────────────────────────────────────────────────
  61  |   test("SR04 - POST /requests cria solicitação com status 'pendente' e TOTP válido", async ({ page }) => {
  62  |     await login(page, "cadete");
  63  |     await setupTOTP(page);
  64  |     const { request_id } = await createMaterialRequest(page);
  65  |     expect(request_id).toMatch(/^[0-9a-f-]{36}$/);
  66  | 
  67  |     const { data } = await bffCall(page, "GET", "/api/ssa/requests");
  68  |     const requests = data as { id: string; status: string; totp_validated: boolean }[];
  69  |     const req = requests.find((r) => r.id === request_id);
  70  |     expect(req?.status).toBe("pendente");
  71  |     expect(req?.totp_validated).toBe(true);
  72  |   });
  73  | 
  74  |   // ── SR05 ──────────────────────────────────────────────────────────────────
  75  |   test("SR05 - segundo pedido com 1 pendente retorna 403", async ({ page }) => {
  76  |     await login(page, "cadete");
  77  |     await setupTOTP(page);
  78  |     await createMaterialRequest(page);
  79  | 
  80  |     // Attempt second request
  81  |     const material = await getFirstAvailableMaterial(page);
  82  |     const code = await getTOTPCode(page);
  83  |     const { status, data } = await bffCall(page, "POST", "/api/ssa/requests", {
  84  |       items: [{ material_type_id: material.id, quantity: 1 }],
  85  |       totp_token: code,
  86  |     });
  87  |     expect(status).toBe(403);
  88  |     expect((data as { error: string }).error).toMatch(/pendente|aprovad/i);
  89  |   });
  90  | 
  91  |   // ── SR06 ──────────────────────────────────────────────────────────────────
  92  |   test("SR06 - POST /requests retorna 403 para armeiro (role=master)", async ({ page }) => {
  93  |     await login(page, "armeiro");
  94  |     const { status } = await bffCall(page, "POST", "/api/ssa/requests", {
  95  |       items: [{ material_type_id: "00000000-0000-0000-0000-000000000001", quantity: 1 }],
  96  |       totp_token: "123456",
  97  |     });
  98  |     expect(status).toBe(403);
  99  |   });
  100 | 
  101 |   // ── SR07 ──────────────────────────────────────────────────────────────────
  102 |   test("SR07 - GET /requests retorna apenas pedidos do próprio cadete", async ({ page }) => {
  103 |     await login(page, "cadete");
  104 |     await setupTOTP(page);
  105 |     await createMaterialRequest(page);
  106 | 
  107 |     const { data } = await bffCall(page, "GET", "/api/ssa/requests");
  108 |     const requests = data as { military: { matricula: string } }[];
  109 |     for (const r of requests) {
  110 |       expect(r.military?.matricula).toBe("000003");
  111 |     }
  112 |   });
  113 | 
  114 |   // ── SR08 ──────────────────────────────────────────────────────────────────
  115 |   test("SR08 - DELETE /requests/:id cancela pedido pendente (próprio militar)", async ({ page }) => {
  116 |     await login(page, "cadete");
  117 |     await setupTOTP(page);
  118 |     const { request_id } = await createMaterialRequest(page);
  119 | 
  120 |     const { status } = await bffCall(page, "DELETE", `/api/ssa/requests/${request_id}`);
  121 |     expect(status).toBe(200);
  122 | 
  123 |     const { data } = await bffCall(page, "GET", "/api/ssa/requests");
  124 |     const requests = data as { id: string; status: string }[];
  125 |     const req = requests.find((r) => r.id === request_id);
  126 |     expect(req?.status).toBe("cancelado");
  127 |   });
  128 | 
  129 |   // ── SR09 ──────────────────────────────────────────────────────────────────
  130 |   test("SR09 - cadete não pode cancelar pedido já aprovado (403)", async ({ page }) => {
  131 |     await login(page, "cadete");
  132 |     await setupTOTP(page);
  133 |     const { request_id } = await createMaterialRequest(page);
  134 | 
  135 |     // Approve as armeiro
  136 |     await login(page, "armeiro");
```