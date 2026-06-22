# Fase 11 — Migração Infra Brasil (Cloud Run)

> **DoD Canônica:** IMPLEMENTADO NÃO É ENTREGUE — ver `../07-canonical-definition-of-done.md`  
> **Harness ID:** PH-11  
> **Premissa:** Fase 10 concluída  
> **⚠️ ATENÇÃO:** Esta fase é APENAS documentação, planejamento e checklist. Não executar a migração sem aprovação explícita.

---

## Objetivo

Documentar e planejar a migração do BFF de Hetzner VPS (Alemanha) para Google Cloud Run southamerica-east1 (Brasil), para conformidade com LGPD e redução de latência para usuários brasileiros.

**Esta fase NÃO executa a migração.** Apenas produz o plano executável.

---

## Por que Brasil?

O BFF atual roda em Hetzner VPS em Frankfurt, Alemanha. Isso cria:
- **Risco LGPD P0:** dados de cidadãos brasileiros processados fora do Brasil sem DPA
- **Latência:** ~200ms adicional vs. Cloud Run sa-east-1 (~10ms)
- **Custo:** Hetzner €14/mês vs. Cloud Run ~R$150/mês (pay-per-request)

---

## Fora do Escopo

- ❌ Executar a migração (apenas planejar)
- ❌ Migrar Supabase (já está em AWS sa-east-1)
- ❌ Alterar código do BFF (já deve rodar em qualquer container)
- ❌ Migrar CF Pages (permanece no Cloudflare)

---

## Arquivos Deste Plano

Este documento IS o entregável da Fase 11. Nenhum arquivo de código é alterado.

---

## Checklist de Migração Cloud Run

### 1. Pré-requisitos no Google Cloud

```bash
# Projeto GCP
gcloud projects create apmcb-bff --name="APMCB BFF"
gcloud config set project apmcb-bff

# APIs necessárias
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudlogging.googleapis.com

# Região: southamerica-east1 (São Paulo)
export REGION=southamerica-east1
```

### 2. Artifacts Registry

```bash
gcloud artifacts repositories create apmcb-bff \
  --repository-format=docker \
  --location=$REGION
```

### 3. Build e Push da Imagem

```bash
# O Dockerfile já existe em apps/bff/Dockerfile
cd apps/bff
docker build -t $REGION-docker.pkg.dev/apmcb-bff/apmcb-bff/bff:latest .
docker push $REGION-docker.pkg.dev/apmcb-bff/apmcb-bff/bff:latest
```

### 4. Secrets no Google Secret Manager

```bash
# Variáveis de ambiente que vão para Secret Manager
# NUNCA commitar valores reais
gcloud secrets create SUPABASE_URL --data-file=-
gcloud secrets create SUPABASE_SERVICE_ROLE_KEY --data-file=-
gcloud secrets create IRON_SESSION_SECRET --data-file=-
gcloud secrets create CORS_ORIGINS --data-file=-
gcloud secrets create RESEND_API_KEY --data-file=-
gcloud secrets create TURNSTILE_SECRET_KEY --data-file=-
gcloud secrets create VAPID_PUBLIC_KEY --data-file=-
gcloud secrets create VAPID_PRIVATE_KEY --data-file=-
```

### 5. Deploy no Cloud Run

```bash
gcloud run deploy apmcb-bff \
  --image=$REGION-docker.pkg.dev/apmcb-bff/apmcb-bff/bff:latest \
  --region=$REGION \
  --platform=managed \
  --allow-unauthenticated \
  --port=3001 \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=10 \
  --concurrency=80 \
  --set-secrets=SUPABASE_URL=SUPABASE_URL:latest,... \
  --update-env-vars=NODE_ENV=production
```

### 6. Health Check

```bash
# Verificar que o BFF responde após o deploy
curl -f https://[cloud-run-url]/health
# Deve retornar 200 { "status": "ok" }
```

### 7. Atualização de CORS

O BFF lê `CORS_ORIGINS` da variável de ambiente. Atualizar o secret para incluir a URL do CF Pages:
```
CORS_ORIGINS=https://[cf-pages-url],https://[custom-domain]
```

### 8. Atualizar NEXT_PUBLIC_BFF_URL no CF Pages

No CF Pages dashboard → Settings → Environment variables:
```
NEXT_PUBLIC_BFF_URL=https://[cloud-run-url]
```

### 9. Cutover de DNS (se houver domínio do BFF)

Se `bff.dominio.com.br` aponta para o Hetzner:
```
# Antes: A record → 91.99.113.89 (Hetzner)
# Depois: CNAME → [cloud-run-url]
```

### 10. Smoke Test Pós-Migração

```bash
# Rodar smoke test contra o novo BFF
NEXT_PUBLIC_BFF_URL=https://[cloud-run-url] \
  cd apps/web && pnpm test:e2e --project=chromium
```

### 11. Desativação do Hetzner (após validação)

```bash
# Apenas após 48h de operação estável no Cloud Run
# Parar o container no Hetzner
ssh hetzner "docker compose -f /opt/apmcb/docker-compose.yml stop"
# Manter VPS por mais 30 dias antes de cancelar (segurança)
```

---

## Estimativa de Custo

| Item | Hetzner atual | Cloud Run Brasil |
|---|---|---|
| Compute | €14/mês (VPS CX21) | ~R$0-150/mês (pay-per-request) |
| Egress | Incluído | R$0.10/GB |
| Latência p50 | ~200ms (DE→BR) | ~10ms (BR→BR) |
| SLA | 99.9% (manual) | 99.95% (gerenciado) |

---

## Riscos e Mitigações

| Risco | Mitigação |
|---|---|
| Variáveis de ambiente faltando no Cloud Run | Checklist de secrets (passo 4) |
| CORS não configurado para nova URL | Atualizar CORS_ORIGINS (passo 7) |
| iron-session inválida após URL change | Força logout de todos os usuários no cutover |
| Performance de cold start (min-instances=0) | Configurar min-instances=1 em produção |
| Custo inesperado | Configurar billing alert no GCP |

---

## Decisão de Go/No-Go

Executar a migração apenas quando:
- [ ] Produto aprovado por pelo menos 1 cliente piloto
- [ ] Risco LGPD formalmente avaliado pelo responsável legal
- [ ] Budget aprovado para Cloud Run
- [ ] Plano de rollback validado (manter Hetzner por 30 dias pós-migração)

---

## Relatório desta Fase

O relatório da Fase 11 é este documento + aprovação formal do responsável.

**Status:** Plano documentado — aguardando aprovação para execução.

---

*Fase 11 — Migração Infra Brasil v1.0 — 2026-06-20*
