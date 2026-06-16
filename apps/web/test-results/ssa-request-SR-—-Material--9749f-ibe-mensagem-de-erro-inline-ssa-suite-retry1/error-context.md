# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ssa-request.spec.ts >> SR — Material Request (Cadete) >> SR13 - UI: submeter com código errado exibe mensagem de erro inline
- Location: e2e\ssa-request.spec.ts:176:7

# Error details

```
TimeoutError: locator.click: Timeout 10000ms exceeded.
Call log:
  - waiting for locator('[data-testid="material-card"]').first()

```

# Page snapshot

```yaml
- generic [ref=e1]:
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
              - button "Requisitar Armamento" [active] [ref=e64] [cursor=pointer]:
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
  - generic [ref=e147]:
    - generic [ref=e148]:
      - generic [ref=e149]:
        - img [ref=e150]
        - heading "Requisitar Armamento" [level=2] [ref=e152]
      - paragraph [ref=e153]: Selecione os materiais e informe a quantidade desejada.
    - generic [ref=e155]:
      - img [ref=e156]
      - text: Falha ao carregar materiais.
    - generic [ref=e158]:
      - button "Avançar — 0 items selecionados" [disabled]:
        - text: Avançar — 0 items selecionados
        - img
    - button "Close" [ref=e159]:
      - img
      - generic [ref=e160]: Close
```

# Test source

```ts
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
  160 |     await expect(cards.first()).toBeVisible({ timeout: 8_000 });
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
> 181 |     await page.locator('[data-testid="material-card"]').first().click();
      |                                                                 ^ TimeoutError: locator.click: Timeout 10000ms exceeded.
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
  261 |     expect(found).toBeTruthy();
  262 |   });
  263 | 
  264 |   // ── SR20 ──────────────────────────────────────────────────────────────────
  265 |   test("SR20 - cadete não vê pedidos de outros militares (RLS)", async ({ page }) => {
  266 |     // Create request as cadete
  267 |     await login(page, "cadete");
  268 |     await setupTOTP(page);
  269 |     const { request_id } = await createMaterialRequest(page);
  270 | 
  271 |     // Admin cannot see cadete's requests via cadete endpoint
  272 |     // (different test: here we confirm the list only has cadete's own)
  273 |     const { data } = await bffCall(page, "GET", "/api/ssa/requests");
  274 |     const requests = data as { military: { matricula: string } }[];
  275 |     for (const r of requests) {
  276 |       // Every request should belong to the current user (cadete)
  277 |       expect(r.military?.matricula).toBe("000003");
  278 |     }
  279 |   });
  280 | });
  281 | 
```