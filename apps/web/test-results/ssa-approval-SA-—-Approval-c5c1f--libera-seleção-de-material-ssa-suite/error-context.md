# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ssa-approval.spec.ts >> SA — Approval Flow (Armeiro) >> SA18 - Modo A: código TOTP correto no dialog libera seleção de material
- Location: e2e\ssa-approval.spec.ts:276:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByTestId('militar-verified-name')
Expected: visible
Timeout: 8000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 8000ms
  - waiting for getByTestId('militar-verified-name')

```

```yaml
- region "Notifications alt+T"
- dialog "Verificar Código de Acesso":
  - heading "Verificar Código de Acesso" [level=2]
  - paragraph: Informe a matrícula e o código gerado pelo militar.
  - text: Matrícula
  - textbox "Matrícula":
    - /placeholder: "000000"
    - text: "000003"
  - text: Código TOTP (6 dígitos)
  - textbox "Código TOTP (6 dígitos)":
    - /placeholder: 000 000
    - text: "835582"
  - text: Erro ao buscar militar. Tente novamente.
  - button "Cancelar"
  - button "Verificar"
```

# Test source

```ts
  191 | 
  192 |     await login(page, "armeiro");
  193 |     await page.goto(`${BASE_URL}/armeiro/solicitacoes`);
  194 |     await page.getByTestId("tab-pendentes").click();
  195 | 
  196 |     const rows = page.getByTestId("ssa-row");
  197 |     await expect(rows.first()).toBeVisible({ timeout: 8_000 });
  198 | 
  199 |     const badges = rows.locator('[data-testid="status-badge"]');
  200 |     const count = await badges.count();
  201 |     for (let i = 0; i < count; i++) {
  202 |       await expect(badges.nth(i)).toHaveText(/pendente/i);
  203 |     }
  204 |   });
  205 | 
  206 |   // ── SA13 ──────────────────────────────────────────────────────────────────
  207 |   test("SA13 - botão 'Aprovar' visível em pedido pendente expandido", async ({ page }) => {
  208 |     await login(page, "cadete");
  209 |     await setupTOTP(page);
  210 |     await createMaterialRequest(page);
  211 | 
  212 |     await login(page, "armeiro");
  213 |     await page.goto(`${BASE_URL}/armeiro/solicitacoes`);
  214 |     await page.getByTestId("tab-pendentes").click();
  215 |     // Expand first row
  216 |     await page.getByTestId("ssa-row").first().click();
  217 |     await expect(page.getByTestId("btn-aprovar").first()).toBeVisible({ timeout: 5_000 });
  218 |   });
  219 | 
  220 |   // ── SA14 ──────────────────────────────────────────────────────────────────
  221 |   test("SA14 - UI: rejeição sem motivo bloqueia botão de confirmar", async ({ page }) => {
  222 |     await login(page, "cadete");
  223 |     await setupTOTP(page);
  224 |     await createMaterialRequest(page);
  225 | 
  226 |     await login(page, "armeiro");
  227 |     await page.goto(`${BASE_URL}/armeiro/solicitacoes`);
  228 |     await page.getByTestId("tab-pendentes").click();
  229 |     await page.getByTestId("ssa-row").first().click();
  230 |     await page.getByTestId("btn-rejeitar").first().click();
  231 | 
  232 |     const confirmBtn = page.getByTestId("btn-confirmar-rejeicao");
  233 |     await expect(confirmBtn).toBeVisible();
  234 |     await expect(confirmBtn).toBeDisabled(); // disabled until reason is filled
  235 |   });
  236 | 
  237 |   // ── SA15 ──────────────────────────────────────────────────────────────────
  238 |   test("SA15 - expire_material_requests() muda status aprovado-vencido para expirado", async ({ page }) => {
  239 |     await login(page, "cadete");
  240 |     await setupTOTP(page);
  241 |     const { request_id } = await createMaterialRequest(page);
  242 | 
  243 |     await login(page, "armeiro");
  244 |     await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/approve`);
  245 |     await forceExpireRequest(request_id);
  246 | 
  247 |     const { data } = await bffCall(page, "GET", "/api/ssa/requests");
  248 |     const requests = data as { id: string; status: string }[];
  249 |     const req = requests.find((r) => r.id === request_id);
  250 |     expect(req?.status).toBe("expirado");
  251 |   });
  252 | 
  253 |   // ── SA16 ──────────────────────────────────────────────────────────────────
  254 |   test("SA16 - audit_logs registra ssa.solicitado, ssa.aprovado e ssa.retirado", async ({ page }) => {
  255 |     await login(page, "cadete");
  256 |     await setupTOTP(page);
  257 |     const { request_id } = await createMaterialRequest(page);
  258 | 
  259 |     await login(page, "armeiro");
  260 |     await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/approve`);
  261 |     await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/deliver`);
  262 | 
  263 |     await assertAuditLog(request_id, "ssa.solicitado");
  264 |     await assertAuditLog(request_id, "ssa.aprovado");
  265 |     await assertAuditLog(request_id, "ssa.retirado");
  266 |   });
  267 | 
  268 |   // ── SA17 ──────────────────────────────────────────────────────────────────
  269 |   test("SA17 - Modo A: botão 'Verificar Código' visível no dashboard armeiro", async ({ page }) => {
  270 |     await login(page, "armeiro");
  271 |     await page.goto(`${BASE_URL}/armeiro`);
  272 |     await expect(page.getByTestId("btn-verificar-codigo")).toBeVisible({ timeout: 10_000 });
  273 |   });
  274 | 
  275 |   // ── SA18 ──────────────────────────────────────────────────────────────────
  276 |   test("SA18 - Modo A: código TOTP correto no dialog libera seleção de material", async ({ page }) => {
  277 |     await login(page, "cadete");
  278 |     await setupTOTP(page);
  279 |     const code = await getTOTPCode(page);
  280 | 
  281 |     await login(page, "armeiro");
  282 |     await page.goto(`${BASE_URL}/armeiro`);
  283 |     await page.getByTestId("btn-verificar-codigo").click();
  284 |     await expect(page.getByTestId("dialog-verificar-totp")).toBeVisible({ timeout: 5_000 });
  285 | 
  286 |     await page.getByTestId("input-matricula").fill("000003");
  287 |     await page.getByTestId("input-totp-code").fill(code);
  288 |     await page.getByTestId("btn-verificar-submit").click();
  289 | 
  290 |     // After validation: military name shown + saída direta button
> 291 |     await expect(page.getByTestId("militar-verified-name")).toBeVisible({ timeout: 8_000 });
      |                                                             ^ Error: expect(locator).toBeVisible() failed
  292 |     await expect(page.getByTestId("btn-saida-direta")).toBeVisible();
  293 |   });
  294 | });
  295 | 
```