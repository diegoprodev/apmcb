# Fase 12 — API Segura + Webhooks

> **DoD Canônica:** IMPLEMENTADO NÃO É ENTREGUE — ver `../07-canonical-definition-of-done.md`  
> **Harness ID:** PH-12  
> **Premissa:** Fase 10 concluída (Fase 11 é paralela/opcional)  
> **⚠️ ATENÇÃO:** Esta fase é APENAS especificação técnica. Não implementar sem aprovação explícita.

---

## Objetivo

Especificar (não implementar) a API pública v1 da plataforma com autenticação por API key por tenant, escopos de acesso e webhooks HMAC-SHA256 para integrações com sistemas externos de órgãos de segurança pública.

---

## Fora do Escopo

- ❌ Implementar a API agora
- ❌ Alterar qualquer código existente
- ❌ Criar tabelas agora
- ❌ Integração com sistemas específicos de terceiros

---

## Arquivos Desta Fase

Este documento IS o entregável. Nenhum arquivo de código é alterado.

---

## Especificação da API v1

### Base Path

```
/v1/                 # API pública (separada do BFF atual /api/)
/api/                # BFF interno (existente, não alterar)
```

### Autenticação

- **Método:** Header `Authorization: Bearer <api_key>`
- **Formato da key:** `apmcb_live_<32 bytes hex>` (64 chars)
- **Armazenamento:** SHA-256 hash no banco — nunca o valor plaintext
- **Escopo:** por tenant (uma key por tenant)
- **Rate limit:** 1000 req/h por API key (não por IP)
- **Revogação:** soft delete com `revoked_at`

### Tabela `api_keys` (a criar na implementação)

```sql
CREATE TABLE api_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  nome            TEXT NOT NULL,
  key_hash        TEXT NOT NULL UNIQUE,   -- SHA-256 da key — nunca plaintext
  escopos         TEXT[] NOT NULL,        -- ["militares:read", "cautelas:read"]
  ip_allowlist    INET[],                 -- null = sem restrição de IP
  ultima_uso      TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  criado_por      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

### Escopos Disponíveis

| Escopo | Acesso |
|---|---|
| `militares:read` | GET /v1/militares, /v1/militares/:id |
| `cautelas:read` | GET /v1/cautelas, /v1/cautelas/:id |
| `cautelas:write` | POST /v1/cautelas, PATCH /v1/cautelas/:id/return |
| `inventarios:read` | GET /v1/inventarios |
| `passagens:read` | GET /v1/passagens |
| `audit:read` | GET /v1/audit-events |
| `webhooks:manage` | POST/DELETE /v1/webhooks |

---

## Endpoints v1 (Especificação)

### Militares

```
GET  /v1/militares          → Lista militares do tenant (paginado)
GET  /v1/militares/:id      → Detalhe de um militar
```

### Cautelas

```
GET    /v1/cautelas          → Lista cautelas (filtros: status, data, militar)
GET    /v1/cautelas/:id      → Detalhe de uma cautela
POST   /v1/cautelas          → Emitir cautela (escopo: cautelas:write)
PATCH  /v1/cautelas/:id/return → Devolver (escopo: cautelas:write)
```

### Inventários

```
GET  /v1/inventarios         → Lista campanhas de inventário
GET  /v1/inventarios/:id     → Detalhe + progresso
```

---

## Webhooks

### Registro

```
POST   /v1/webhooks          → Registrar webhook
DELETE /v1/webhooks/:id      → Revogar webhook
GET    /v1/webhooks          → Listar webhooks ativos
```

### Payload de Webhook

```json
{
  "id": "evt_uuid",
  "type": "cautela.created",
  "tenant_id": "uuid",
  "created_at": "ISO timestamp",
  "data": { ... }
}
```

### Assinatura HMAC-SHA256

```
Header: X-APMCB-Signature: sha256=<hmac>

# Cálculo do HMAC
secret = webhook.secret (gerado no registro, armazenado hash)
payload = JSON.stringify(webhookPayload)
signature = HMAC-SHA256(secret, payload)
```

### Eventos Disponíveis

| Evento | Quando |
|---|---|
| `cautela.created` | Cautela emitida |
| `cautela.returned` | Cautela devolvida |
| `cautela.divergence` | Divergência na devolução |
| `handover.completed` | Passagem de serviço concluída |
| `inventory.campaign.closed` | Inventário encerrado |
| `audit.export` | Exportação de dados de auditoria |

---

## Tabela `webhook_subscriptions` (a criar na implementação)

```sql
CREATE TABLE webhook_subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  url             TEXT NOT NULL,
  eventos         TEXT[] NOT NULL,
  secret_hash     TEXT NOT NULL,    -- SHA-256 do secret — nunca plaintext
  status          TEXT DEFAULT 'ativo',
  ultima_entrega  TIMESTAMPTZ,
  falhas_consecutivas INT DEFAULT 0,
  criado_por      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

---

## Documentação OpenAPI (Rascunho)

```yaml
openapi: 3.0.3
info:
  title: Plataforma de Governança de Bens Sensíveis — API v1
  version: 1.0.0
  description: API para integração com sistemas de controle de armamento

servers:
  - url: https://[bff-url]/v1
    description: Produção

security:
  - BearerAuth: []

components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: APMCB API Key

  schemas:
    Cautela:
      type: object
      properties:
        id: { type: string, format: uuid }
        material_descricao: { type: string }
        militar_nome: { type: string }
        status: { type: string, enum: [emitida, ativa, devolvida, divergencia] }
        data_emissao: { type: string, format: date-time }
```

---

## Considerações de Segurança

1. **API keys nunca em plaintext no banco** — apenas SHA-256 hash
2. **Webhook secrets nunca em plaintext** — apenas SHA-256 hash
3. **IP allowlist** — opcional mas recomendado para integrações fixas
4. **Rate limit por key** — separado do rate limit do BFF
5. **Logs de uso** — cada request da API registra em `audit_events` com action="api.request"
6. **Revogação imediata** — soft delete com `revoked_at`, checado em cada request
7. **TLS obrigatório** — URLs de webhook devem ser HTTPS

---

## Critério de Implementação

Implementar a Fase 12 apenas quando:
- [ ] Primeiro cliente enterprise com necessidade de integração identificado
- [ ] Caso de uso específico de integração documentado
- [ ] Estimativa de volume de requests definida (para sizing do rate limit)

---

*Fase 12 — API Segura + Webhooks v1.0 — 2026-06-20*
