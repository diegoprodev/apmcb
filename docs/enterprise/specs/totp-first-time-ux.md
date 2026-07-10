# Spec — UX de configuração TOTP na primeira vez

**Data:** 2026-07-10
**Autor:** Investigação + implementação nesta sessão (achados empíricos, não teóricos)
**Status:** Implementado

## Contexto

O usuário pediu uma varredura do sistema de TOTP com foco em "por que e como configurar
o TOTP pela primeira vez deveria ser mais amigável", pedindo uma spec seguida de execução.

## O que já está certo (não mexer)

O fluxo de setup em si **já é praticamente sem fricção** — não é o modelo tradicional de
2FA (escanear QR code com Google Authenticator, digitar o primeiro código para confirmar
pareamento). Este sistema é um "soft-token": o próprio backend gera e guarda o secret, e
o app mostra o código atual (com contagem regressiva) direto na tela, sem exigir nenhum
app externo. Isso já elimina a maior fonte de fricção de TOTP tradicional.

`TOTPSetupCard` (`apps/web/src/components/ssa/totp-setup-card.tsx`) já faz:
1. Auto-setup silencioso no primeiro mount, se `totp_configured=false` (`POST /api/totp/setup`).
2. Auto-expande o card revelando o código imediatamente após o setup.
3. Estado colapsado/expandido para não poluir a tela depois da primeira vez.
4. Fallback de "Reconfigurar agora" quando o secret está corrompido (`needs_reconfigure`).

Esse componente é sólido e não precisa ser redesenhado.

## O problema real encontrado (evidência empírica desta sessão)

`TOTPSetupCard`/`TOTPDisplay` estava montado **apenas** em duas páginas:
- `apps/web/src/app/(dashboard)/efetivo/page.tsx`
- `apps/web/src/app/(dashboard)/efetivo/perfil/page.tsx`

Ou seja: **somente o papel `usuario` (efetivo) tinha qualquer superfície de UI para TOTP.**
Armeiro, admin_reserva e admin_global — que também precisam de TOTP para assinar
cautelas (`sign-armeiro`), abrir/fechar turno no Livro Digital, e outras ações sensíveis —
não tinham:
- Nenhuma indicação de que precisavam configurar um código.
- Nenhum lugar para ver o código já configurado.
- Nenhum aviso quando o secret estava corrompido.

**Consequência real, não hipotética:** nesta mesma sessão, tive que corrigir o TOTP de
3 contas (000003/usuario, admin_global, admin_reserva 000004) chamando `/api/totp/reconfigure`
manualmente via API, porque essas contas não tinham *nenhum* caminho de UI para o próprio
usuário resolver isso sozinho. Isso é o oposto de "sem fricção" — é fricção total (suporte
manual obrigatório) para 3 dos 5 papéis do sistema.

Um segundo ponto, já corrigido antes desta spec: o diálogo de assinatura (`SignDialog`,
usado tanto por armeiro quanto por militar) pedia um código TOTP de 6 dígitos sem mostrar
o código em lugar nenhum — o usuário precisaria adivinhar ou navegar para outra tela
enquanto o diálogo modal bloqueava a interface. Corrigido com `SelfTotpHint` inline no
próprio diálogo (busca `GET /api/totp/code` a cada 5s, um toque preenche o campo).

## Correção implementada

Reusar `TOTPSetupCard` (nenhum componente novo, nenhuma duplicação) na página de perfil
genérica `apps/web/src/app/(dashboard)/perfil/` — usada por armeiro, admin_reserva e
admin_global. Isso dá aos outros 3 papéis a mesma paridade de auto-setup + visibilidade
que o efetivo já tinha, sem inventar um padrão visual novo (conforme a regra de UI
Consistency Canônica do projeto).

### Mudança
- `apps/web/src/app/(dashboard)/perfil/page.tsx`: busca `totp_configured` do profile
  (mesmo padrão já usado em `efetivo/perfil/page.tsx`) e passa para o client component.
- `apps/web/src/app/(dashboard)/perfil/_profile-client.tsx`: recebe `totpConfigured` como
  prop e renderiza `<TOTPSetupCard configured={totpConfigured} />` na mesma posição
  hierárquica (após os dados pessoais, antes das preferências do sistema).

## Fora do escopo desta correção

- Auditor e superadmin (Nexus) não usam TOTP para assinar documentos (não têm fluxo de
  assinatura de cautela/handover) — não precisam do card. Nexus/superadmin já tem seu
  próprio fluxo de 2FA obrigatório no login (`/nexus/setup-2fa`), estrutural e diferente.
- Redesenho visual do card em si — já está alinhado ao design system, não há necessidade.
- Onboarding modal/tour explicando o conceito de TOTP — o card já se auto-explica
  ("Configure para se armar por código" → expande sozinho mostrando o código); um tour
  adicional seria fricção extra, não redução.
