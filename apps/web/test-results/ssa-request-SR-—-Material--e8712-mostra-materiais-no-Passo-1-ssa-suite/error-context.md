# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ssa-request.spec.ts >> SR — Material Request (Cadete) >> SR11 - UI: Sheet abre e mostra materiais no Passo 1
- Location: e2e\ssa-request.spec.ts:153:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('[data-testid="material-card"]').first()
Expected: visible
Timeout: 8000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 8000ms
  - waiting for locator('[data-testid="material-card"]').first()

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
- heading "Requisitar Armamento" [level=2]
- paragraph: Selecione os materiais e informe a quantidade desejada.
- text: Falha ao carregar materiais.
- button "Avançar — 0 items selecionados" [disabled]
- button "Close"
```

# Test source

```ts
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
  137 |     await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/approve`);
  138 | 
  139 |     // Try cancel as cadete
  140 |     await login(page, "cadete");
  141 |     const { status } = await bffCall(page, "DELETE", `/api/ssa/requests/${request_id}`);
  142 |     expect(status).toBe(403);
  143 |   });
  144 | 
  145 |   // ── SR10 ──────────────────────────────────────────────────────────────────
  146 |   test("SR10 - UI: botão 'Solicitar Armamento' visível no dashboard cadete", async ({ page }) => {
  147 |     await login(page, "cadete");
  148 |     await page.goto(`${BASE_URL}/cadete`);
  149 |     await expect(page.getByTestId("btn-solicitar-armamento")).toBeVisible({ timeout: 10_000 });
  150 |   });
  151 | 
  152 |   // ── SR11 ──────────────────────────────────────────────────────────────────
  153 |   test("SR11 - UI: Sheet abre e mostra materiais no Passo 1", async ({ page }) => {
  154 |     await login(page, "cadete");
  155 |     await page.goto(`${BASE_URL}/cadete`);
  156 |     await page.getByTestId("btn-solicitar-armamento").click();
  157 |     await expect(page.getByTestId("ssa-step-materials")).toBeVisible({ timeout: 8_000 });
  158 |     // At least one material card present
  159 |     const cards = page.locator('[data-testid="material-card"]');
> 160 |     await expect(cards.first()).toBeVisible({ timeout: 8_000 });
      |                                 ^ Error: expect(locator).toBeVisible() failed
  161 |   });
  162 | 
  163 |   // ── SR12 ──────────────────────────────────────────────────────────────────
  164 |   test("SR12 - UI: avança para Passo 2 com TOTPDisplay após selecionar material", async ({ page }) => {
  165 |     await login(page, "cadete");
  166 |     await bffCall(page, "POST", "/api/totp/setup");
  167 |     await page.goto(`${BASE_URL}/cadete`);
  168 |     await page.getByTestId("btn-solicitar-armamento").click();
  169 |     await page.locator('[data-testid="material-card"]').first().click();
  170 |     await page.getByTestId("btn-step-next").click();
  171 |     await expect(page.getByTestId("totp-display")).toBeVisible({ timeout: 10_000 });
  172 |     await expect(page.getByTestId("totp-input")).toBeVisible();
  173 |   });
  174 | 
  175 |   // ── SR13 ──────────────────────────────────────────────────────────────────
  176 |   test("SR13 - UI: submeter com código errado exibe mensagem de erro inline", async ({ page }) => {
  177 |     await login(page, "cadete");
  178 |     await bffCall(page, "POST", "/api/totp/setup");
  179 |     await page.goto(`${BASE_URL}/cadete`);
  180 |     await page.getByTestId("btn-solicitar-armamento").click();
  181 |     await page.locator('[data-testid="material-card"]').first().click();
  182 |     await page.getByTestId("btn-step-next").click();
  183 |     await page.getByTestId("totp-input").fill("000000");
  184 |     await page.getByTestId("btn-submit-request").click();
  185 |     await expect(page.getByText(/código inválido/i)).toBeVisible({ timeout: 8_000 });
  186 |   });
  187 | 
  188 |   // ── SR14 ──────────────────────────────────────────────────────────────────
  189 |   test("SR14 - UI: botão solicitar oculto quando há pedido ativo", async ({ page }) => {
  190 |     await login(page, "cadete");
  191 |     await setupTOTP(page);
  192 |     await createMaterialRequest(page);
  193 |     await page.goto(`${BASE_URL}/cadete`);
  194 |     // btn should be hidden when active request exists
  195 |     const btn = page.getByTestId("btn-solicitar-armamento");
  196 |     await expect(btn).toHaveCount(0);
  197 |   });
  198 | 
  199 |   // ── SR15 ──────────────────────────────────────────────────────────────────
  200 |   test("SR15 - items retornam com snapshots de nome e categoria", async ({ page }) => {
  201 |     await login(page, "cadete");
  202 |     await setupTOTP(page);
  203 |     await createMaterialRequest(page);
  204 | 
  205 |     const { data } = await bffCall(page, "GET", "/api/ssa/requests");
  206 |     const requests = data as { items: { material_nome_snapshot: string; material_categoria_snapshot: string }[] }[];
  207 |     expect(requests[0].items[0].material_nome_snapshot).toBeTruthy();
  208 |     expect(requests[0].items[0].material_categoria_snapshot).toBeTruthy();
  209 |   });
  210 | 
  211 |   // ── SR16 ──────────────────────────────────────────────────────────────────
  212 |   test("SR16 - POST /requests com quantity=0 retorna 400 (validação Zod)", async ({ page }) => {
  213 |     await login(page, "cadete");
  214 |     await setupTOTP(page);
  215 |     const code = await getTOTPCode(page);
  216 |     const material = await getFirstAvailableMaterial(page);
  217 | 
  218 |     const { status } = await bffCall(page, "POST", "/api/ssa/requests", {
  219 |       items: [{ material_type_id: material.id, quantity: 0 }],
  220 |       totp_token: code,
  221 |     });
  222 |     expect(status).toBe(400);
  223 |   });
  224 | 
  225 |   // ── SR17 ──────────────────────────────────────────────────────────────────
  226 |   test("SR17 - POST /requests sem items retorna 400", async ({ page }) => {
  227 |     await login(page, "cadete");
  228 |     await setupTOTP(page);
  229 |     const code = await getTOTPCode(page);
  230 | 
  231 |     const { status } = await bffCall(page, "POST", "/api/ssa/requests", {
  232 |       items: [],
  233 |       totp_token: code,
  234 |     });
  235 |     expect(status).toBe(400);
  236 |   });
  237 | 
  238 |   // ── SR18 ──────────────────────────────────────────────────────────────────
  239 |   test("SR18 - totp_validated=true e totp_validated_at preenchidos no DB", async ({ page }) => {
  240 |     await login(page, "cadete");
  241 |     await setupTOTP(page);
  242 |     const { request_id } = await createMaterialRequest(page);
  243 | 
  244 |     const { data } = await bffCall(page, "GET", "/api/ssa/requests");
  245 |     const requests = data as { id: string; totp_validated: boolean; totp_validated_at: string }[];
  246 |     const req = requests.find((r) => r.id === request_id);
  247 |     expect(req?.totp_validated).toBe(true);
  248 |     expect(req?.totp_validated_at).toBeTruthy();
  249 |   });
  250 | 
  251 |   // ── SR19 ──────────────────────────────────────────────────────────────────
  252 |   test("SR19 - armeiro vê todos os pedidos (não filtrado por military_id)", async ({ page }) => {
  253 |     await login(page, "cadete");
  254 |     await setupTOTP(page);
  255 |     const { request_id } = await createMaterialRequest(page);
  256 | 
  257 |     await login(page, "armeiro");
  258 |     const { data } = await bffCall(page, "GET", "/api/ssa/requests");
  259 |     const requests = data as { id: string }[];
  260 |     const found = requests.find((r) => r.id === request_id);
```