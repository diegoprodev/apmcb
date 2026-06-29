# Acesso ao Supabase — Regra Canônica

**Project ref:** `jepitcrkicwmvzrmllpn`

---

## Problema recorrente

O MCP do Supabase (`mcp__supabase__*`) perde autenticação entre sessões. Executar SQL diretamente via MCP retorna "You do not have permission to perform this action". Isso ocorre porque o `${SUPABASE_ACCESS_TOKEN}` no `.mcp.json` não está resolvido no ambiente.

---

## Setup único (por máquina de desenvolvimento)

### 1. Variável de ambiente (Windows — persistente)

```powershell
[System.Environment]::SetEnvironmentVariable("SUPABASE_ACCESS_TOKEN", "<token>", "User")
```

O token está em `/opt/apmcb/.env` no VPS: `SUPABASE_ACCESS_TOKEN=sbp_...`

**Reinicie o Claude Code após setar o env var** para que o MCP leia o novo valor.

### 2. Verificar que o `.mcp.json` está correto

O arquivo `c:\projetos\apmcb\.mcp.json` deve ter:

```json
{
  "mcpServers": {
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp?project_ref=jepitcrkicwmvzrmllpn",
      "headers": {
        "Authorization": "Bearer ${SUPABASE_ACCESS_TOKEN}"
      }
    }
  }
}
```

### 3. Testar o MCP após restart

Se o MCP ainda falhar após restart, use o fallback abaixo.

---

## Fallback: Executar SQL via Management API (PowerShell)

Quando o MCP não está autenticado, use este snippet para executar qualquer SQL:

```powershell
$sql = @'
-- Seu SQL aqui
SELECT 1;
'@

$headers = @{
  "Authorization" = "Bearer $env:SUPABASE_ACCESS_TOKEN"
  "Content-Type"  = "application/json"
}
$body = New-Object -TypeName PSObject -Property @{ query = $sql }
$bodyJson = $body | ConvertTo-Json -Depth 3
$tmpFile = [System.IO.Path]::GetTempFileName()
[System.IO.File]::WriteAllText($tmpFile, $bodyJson, [System.Text.Encoding]::UTF8)

$resp = Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/jepitcrkicwmvzrmllpn/database/query" `
  -Method POST -Headers $headers -InFile $tmpFile -TimeoutSec 60
Remove-Item $tmpFile -Force
$resp
```

---

## Fallback 2: SSH + psql via VPS

```bash
ssh -i ~/.ssh/apmcb_hetzner root@91.99.113.89 \
  "PGPASSWORD='<senha>' psql 'postgresql://postgres:<senha_encoded>@db.jepitcrkicwmvzrmllpn.supabase.co:5432/postgres?sslmode=require' -v ON_ERROR_STOP=1" \
  < migration.sql
```

**Nota:** A senha do postgres está em Supabase Dashboard > Project Settings > Database. Encode caracteres especiais na URL (`@`→`%40`, `#`→`%23`).

---

## Aplicar migrations locais via supabase CLI

```powershell
# Autenticar (uma vez por sessão ou após update do CLI)
supabase login --token $env:SUPABASE_ACCESS_TOKEN

# Linkar projeto
supabase link --project-ref jepitcrkicwmvzrmllpn

# Push de novas migrations
supabase db push
```

---

## Prioridade de uso

| Método | Quando usar |
|--------|-------------|
| `mcp__supabase__*` | Sessão normal com env var configurado ✅ |
| Management API (PowerShell) | MCP sem auth — fallback direto ✅ |
| SSH + psql | Migrations complexas / scripts longos |
| Supabase CLI | `supabase db push` para sincronizar migrations locais |

---

*Última atualização: 2026-06-29 — após auditoria global de segurança*
