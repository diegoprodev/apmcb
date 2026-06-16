# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ssa-request.spec.ts >> SR — Material Request (Cadete) >> SR08 - DELETE /requests/:id cancela pedido pendente (próprio militar)
- Location: e2e\ssa-request.spec.ts:115:7

# Error details

```
Error: Failed to create request: HTTP 409 — {"error":"Material \"Espadim\" indisponível na quantidade solicitada.","material_type_id":"6980459a-1d7a-4b36-a9ce-704ae4d1b0c9"}
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
  36  |     .filter((c) => c.name === prefix || c.name.startsWith(`${prefix}.`))
  37  |     .sort((a, b) => a.name.localeCompare(b.name));
  38  |   if (!chunks.length) return null;
  39  |   try {
  40  |     const raw = chunks.map((c) => c.value).join("");
  41  |     // @supabase/ssr v0.12+ encodes as "base64-<base64(json)>"
  42  |     const b64 = raw.startsWith("base64-") ? raw.slice(7) : raw;
  43  |     const decoded = Buffer.from(b64, "base64").toString("utf-8");
  44  |     const session = JSON.parse(decoded);
  45  |     return (session?.access_token as string) ?? null;
  46  |   } catch {
  47  |     return null;
  48  |   }
  49  | }
  50  | 
  51  | export async function bffCall(
  52  |   page: Page,
  53  |   method: string,
  54  |   path: string,
  55  |   body?: unknown
  56  | ): Promise<{ status: number; data: unknown }> {
  57  |   const url = `${BFF_URL}${path}`;
  58  | 
  59  |   // Use Bearer token so the BFF auth middleware accepts us without iron-session.
  60  |   // This also skips CSRF (Bearer = no cookie-based session = no CSRF surface).
  61  |   const token = await getSupabaseToken(page);
  62  | 
  63  |   const res = await page.request.fetch(url, {
  64  |     method,
  65  |     headers: {
  66  |       "Content-Type": "application/json",
  67  |       ...(token ? { Authorization: `Bearer ${token}` } : {}),
  68  |     },
  69  |     data: body ? JSON.stringify(body) : undefined,
  70  |   });
  71  |   let data: unknown;
  72  |   try { data = await res.json(); } catch { data = null; }
  73  |   return { status: res.status(), data };
  74  | }
  75  | 
  76  | // ─── TOTP setup ───────────────────────────────────────────────────────────
  77  | 
  78  | /**
  79  |  * Configure TOTP for the cadete user via BFF (idempotent).
  80  |  */
  81  | export async function setupTOTP(page: Page): Promise<void> {
  82  |   const { status } = await bffCall(page, "POST", "/api/totp/setup");
  83  |   if (status !== 200 && status !== 201) throw new Error(`TOTP setup failed: HTTP ${status}`);
  84  | }
  85  | 
  86  | /**
  87  |  * Get the current TOTP code for the logged-in cadete.
  88  |  * Waits if the code has < 5s remaining to avoid boundary flakiness.
  89  |  */
  90  | export async function getTOTPCode(page: Page): Promise<string> {
  91  |   for (let attempt = 0; attempt < 4; attempt++) {
  92  |     const { status, data } = await bffCall(page, "GET", "/api/totp/code");
  93  |     if (status !== 200) throw new Error(`Failed to get TOTP code: HTTP ${status}`);
  94  |     const body = data as { code: string; seconds_remaining: number };
  95  |     if (body.seconds_remaining > 5) return body.code;
  96  |     // Code expires very soon — wait for next window to avoid race
  97  |     await page.waitForTimeout((body.seconds_remaining + 1) * 1000);
  98  |   }
  99  |   throw new Error("Failed to get stable TOTP code after 4 attempts");
  100 | }
  101 | 
  102 | // ─── Material helpers ─────────────────────────────────────────────────────
  103 | 
  104 | /**
  105 |  * Get the first available material from the SSA endpoint.
  106 |  */
  107 | export async function getFirstAvailableMaterial(
  108 |   page: Page
  109 | ): Promise<{ id: string; nome: string; categoria: string }> {
  110 |   const { status, data } = await bffCall(page, "GET", "/api/ssa/available-materials");
  111 |   if (status !== 200) throw new Error(`Failed to get materials: HTTP ${status}`);
  112 |   const materials = data as { id: string; nome: string; categoria: string }[];
  113 |   if (!materials.length) throw new Error("No available materials in fixture");
  114 |   return materials[0];
  115 | }
  116 | 
  117 | // ─── Request lifecycle ────────────────────────────────────────────────────
  118 | 
  119 | /**
  120 |  * Create a material request for the logged-in cadete.
  121 |  * Returns { request_id, status }.
  122 |  */
  123 | export async function createMaterialRequest(
  124 |   page: Page,
  125 |   overrides?: { quantity?: number }
  126 | ): Promise<{ request_id: string }> {
  127 |   const material = await getFirstAvailableMaterial(page);
  128 |   const code = await getTOTPCode(page);
  129 | 
  130 |   const { status, data } = await bffCall(page, "POST", "/api/ssa/requests", {
  131 |     items: [{ material_type_id: material.id, quantity: overrides?.quantity ?? 1 }],
  132 |     totp_token: code,
  133 |   });
  134 | 
  135 |   if (status !== 201) {
> 136 |     throw new Error(`Failed to create request: HTTP ${status} — ${JSON.stringify(data)}`);
      |           ^ Error: Failed to create request: HTTP 409 — {"error":"Material \"Espadim\" indisponível na quantidade solicitada.","material_type_id":"6980459a-1d7a-4b36-a9ce-704ae4d1b0c9"}
  137 |   }
  138 |   return { request_id: (data as { request_id: string }).request_id };
  139 | }
  140 | 
  141 | /**
  142 |  * Cancel all pending/approved requests for the cadete (DB-direct cleanup).
  143 |  */
  144 | export async function cleanupRequests(): Promise<void> {
  145 |   const db = supabaseAdmin();
  146 |   const cadeteMatricula = USERS.cadete.matricula;
  147 | 
  148 |   const { data: profile } = await db
  149 |     .from("profiles")
  150 |     .select("id")
  151 |     .eq("matricula", cadeteMatricula)
  152 |     .single();
  153 | 
  154 |   if (!profile) return;
  155 | 
  156 |   await db
  157 |     .from("material_requests")
  158 |     .update({ status: "cancelado", cancelled_at: new Date().toISOString() })
  159 |     .eq("military_id", profile.id)
  160 |     .in("status", ["pendente", "aprovado"]);
  161 | 
  162 |   // Reset TOTP anti-replay so next test can reuse the same code period
  163 |   await db
  164 |     .from("totp_secrets")
  165 |     .update({ last_used_token: null, failure_count: 0, last_failure_at: null })
  166 |     .eq("user_id", profile.id);
  167 | 
  168 |   // Return any active lendings so materials go back to available stock
  169 |   await db
  170 |     .from("lendings")
  171 |     .update({ status: "devolvido", returned_at: new Date().toISOString() })
  172 |     .eq("military_id", profile.id)
  173 |     .eq("status", "ativo");
  174 | }
  175 | 
  176 | /**
  177 |  * Force-expire a request by backdating expires_at by 7 hours.
  178 |  * Then call expire_material_requests() to flip the status.
  179 |  */
  180 | export async function forceExpireRequest(requestId: string): Promise<void> {
  181 |   const db = supabaseAdmin();
  182 |   await db
  183 |     .from("material_requests")
  184 |     .update({ expires_at: new Date(Date.now() - 7 * 3600 * 1000).toISOString() })
  185 |     .eq("id", requestId);
  186 | 
  187 |   await db.rpc("expire_material_requests");
  188 | }
  189 | 
  190 | /**
  191 |  * Reset TOTP failure count for the cadete (unlock after rate-limit tests).
  192 |  */
  193 | export async function resetTOTPFailures(): Promise<void> {
  194 |   const db = supabaseAdmin();
  195 |   const cadeteMatricula = USERS.cadete.matricula;
  196 | 
  197 |   const { data: profile } = await db
  198 |     .from("profiles")
  199 |     .select("id")
  200 |     .eq("matricula", cadeteMatricula)
  201 |     .single();
  202 | 
  203 |   if (!profile) return;
  204 | 
  205 |   await db
  206 |     .from("totp_secrets")
  207 |     .update({ failure_count: 0, last_failure_at: null })
  208 |     .eq("user_id", profile.id);
  209 | }
  210 | 
  211 | /**
  212 |  * Return the cadete's profile ID (cached lookup).
  213 |  */
  214 | let _cadeteId: string | undefined;
  215 | export async function getCadeteId(): Promise<string> {
  216 |   if (_cadeteId) return _cadeteId;
  217 |   const db = supabaseAdmin();
  218 |   const { data } = await db
  219 |     .from("profiles")
  220 |     .select("id")
  221 |     .eq("matricula", USERS.cadete.matricula)
  222 |     .single();
  223 |   if (!data) throw new Error("Cadete profile not found in DB");
  224 |   _cadeteId = data.id as string;
  225 |   return _cadeteId;
  226 | }
  227 | 
  228 | /**
  229 |  * Verify audit trail for a given request contains the expected action.
  230 |  */
  231 | export async function assertAuditLog(requestId: string, action: string): Promise<void> {
  232 |   const db = supabaseAdmin();
  233 |   const { data } = await db
  234 |     .from("audit_logs")
  235 |     .select("action")
  236 |     .eq("resource_id", requestId)
```