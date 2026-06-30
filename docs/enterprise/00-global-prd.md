# PRD Global — Plataforma de Governança de Bens Sensíveis

> **Versão:** 1.0  
> **Data:** 2026-06-20  
> **Status:** Aprovado — base para execução enterprise  
> **Repositório:** `c:\projetos\apmcb` (branch `main`)  
> **Supabase Project:** `jepitcrkicwmvzrmllpn`  
> **Domínio ativo:** `apmcb.pmpb.online`

---

## Sumário

1. [Visão do Produto](#1-visão-do-produto)
2. [Público-Alvo](#2-público-alvo)
3. [ICP Primário](#3-icp-primário)
4. [ICP Secundário](#4-icp-secundário)
5. [Problemas Operacionais Reais](#5-problemas-operacionais-reais)
6. [Dores dos Armeiros](#6-dores-dos-armeiros)
7. [Dores dos Administradores](#7-dores-dos-administradores)
8. [Dores do Comando](#8-dores-do-comando)
9. [Dores da Auditoria / Corregedoria / Controle Interno](#9-dores-da-auditoria--corregedoria--controle-interno)
10. [Jobs to Be Done](#10-jobs-to-be-done)
11. [Casos de Uso Principais](#11-casos-de-uso-principais)
12. [Casos de Uso Fora do Escopo](#12-casos-de-uso-fora-do-escopo)
13. [Personas](#13-personas)
14. [Fluxos Críticos](#14-fluxos-críticos)
15. [Proposta de Valor](#15-proposta-de-valor)
16. [Métricas de Sucesso](#16-métricas-de-sucesso)
17. [Riscos de Adoção](#17-riscos-de-adoção)
18. [Requisitos Funcionais](#18-requisitos-funcionais)
19. [Requisitos Não Funcionais](#19-requisitos-não-funcionais)
20. [Requisitos de Segurança](#20-requisitos-de-segurança)
21. [Requisitos de Auditoria](#21-requisitos-de-auditoria)
22. [Requisitos de UX Operacional](#22-requisitos-de-ux-operacional)
23. [Requisitos de Documentação](#23-requisitos-de-documentação)
24. [Critérios para MVP Institucional](#24-critérios-para-mvp-institucional)
25. [Critérios para Produto Enterprise](#25-critérios-para-produto-enterprise)

---

## 1. Visão do Produto

**O que é:** Plataforma cloud/PWA de governança operacional de bens sensíveis para órgãos de segurança pública e instituições similares.

**Problema central:** Reservas de armamento, depósitos de equipamentos e controles de carga em órgãos de segurança pública são gerenciados hoje com livros físicos, planilhas e formulários em papel. O resultado é rastreabilidade zero, impossibilidade de auditoria remota, alto risco jurídico e operações manuais que consomem tempo do efetivo em atividade de guarda.

**Solução:** Substituir completamente o papel e o livro físico por uma plataforma digital com:
- Controle de bens sensíveis em tempo real
- Solicitação remota e aprovação com autenticação forte (TOTP + biometria)
- Cautela eletrônica com assinatura digital e prova criptográfica
- Passagem de serviço digital entre armeiros com assinatura dupla
- Inventário periódico digital com conformidade auditável
- Painel de comando por exceção para gestores
- Auditoria imutável de todas as operações
- Multi-tenant real para escalar para múltiplos órgãos

**Posicionamento:** Não é sistema de estoque. É plataforma de conformidade e rastreabilidade. O estoque é consequência. O produto entrega prestação de contas digital substituindo papel.

**Nome atual do produto:** sem nome comercial definitivo. Referenciar como "Plataforma", "Sistema" ou "Plataforma de Governança de Bens Sensíveis".

---

## 2. Público-Alvo

Órgãos públicos de segurança e defesa que mantêm reservas de bens sensíveis e têm obrigação de rastreabilidade e prestação de contas:

| Segmento | Exemplos | Porte típico |
|---|---|---|
| Polícias Militares estaduais | PM-PB, PM-SP, PM-MG, PM-RJ | 20-5.000 militares por batalhão |
| Polícias Civis estaduais | PC-PB, PC-SP | 10-300 por delegacia |
| Corpos de Bombeiros | CBM-PB, CBMGO | 20-500 por unidade |
| Guardas Municipais | GM-Recife, GCM-SP | 50-2.000 por secretaria |
| Segurança pública federal | PFDF, PRF, DEPEN | 50-2.000 por unidade |
| Forças Armadas (aplicável) | Exército, Marinha, FAB — pelotões e companhias | 50-500 por unidade |

---

## 3. ICP Primário

**Polícias Militares estaduais — unidade de batalhão ou reserva de armamento**

Características:
- 50 a 500 militares por unidade de armamento
- 1 a 4 armeiros (operadores da reserva) por turno
- 1 administrador por batalhão (geralmente capitão ou tenente)
- Processo atual: livro de controle físico, cadernetas de cautela em papel, passagem verbal ou em papel
- Pressão jurídica: irregularidade em carga de armamento é crime militar e razão de inquérito
- Infraestrutura de TI: variável — de máquinas modernas a PCs com Windows 7
- Conectividade: geralmente há internet, às vezes instável em BOs de interior
- Orçamento: limitado, mas há mecanismo de contratação via inexigibilidade ou pregão

**Por que é o ICP:** maior volume de unidades no Brasil, processo mais padronizado entre estados, dor maior (armamento é o item com maior risco jurídico), e decisão de compra centralizada no nível estadual (uma venda = N batalhões).

---

## 4. ICP Secundário

**4.1 Guardas Municipais**
- Porte: 50-2.000 agentes por secretaria
- Diferencial: autonomia municipal de contratação (mais rápido que PM estadual)
- Desafio: menor padronização entre municípios

**4.2 Corpos de Bombeiros**
- Bens além de armas: EPI, equipamentos de resgate, viaturas, cilindros de ar
- Processo similar ao de PM

**4.3 Forças Armadas — unidades menores**
- Pelotões, companhias isoladas
- Processo mais rígido, mas necessidade de rastreabilidade ainda maior
- Ciclo de vendas mais longo

**4.4 Escolas e Academias de Polícia**
- Controle de armas de instrução, coletivos, fardamentos
- Volume menor, mas dor alta em troca de turno
- Piloto zero atual: APMCB (Academia de Polícia Militar do Cabo Branco)

---

## 5. Problemas Operacionais Reais

**5.1 Livro físico como único controle**
O livro de controle de armamento é a única prova de saída e devolução em 90% das reservas. É destruível, falsificável, ilegível e não permite busca rápida. Não existe quando o militar perde ou rouba e afirma que nunca assinou.

**5.2 Cautela em papel sem prova de entrega**
O armeiro entrega a arma, o militar assina um papel. Se o papel some, a cautela some. Se o militar nega ter recebido, não há prova criptográfica. Caso judicial é indefensável.

**5.3 Passagem de serviço verbal ou em papel**
A passagem entre armeiros é feita verbalmente ou com anotação em livro. Divergências entre o que foi passado e o que existia na reserva são descobertas horas depois, sem prova de quando a divergência ocorreu.

**5.4 Inventário manual periódico**
Conferência de carga é feita por contagem física com planilha. Leva dias. Divergências são registradas em ata impressa. Sem rastreabilidade de cada item ao longo do tempo.

**5.5 Solicitação de armamento presencial obrigatória**
Militar tem que ir pessoalmente à reserva para solicitar armamento, mesmo em escala noturna, mesmo em emergência. Armeiro tem que estar presente. Sem possibilidade de aprovação remota com prova de autenticidade.

**5.6 Nenhuma visibilidade em tempo real**
Administrador e comando não têm acesso em tempo real ao estado da reserva. Para saber quantas armas estão em uso, precisam ligar para o armeiro. Relatórios são feitos manualmente, a pedido, com atraso.

**5.7 Relatórios manuais para prestação de contas**
Relatório mensal de movimentação de armamento é feito manualmente, em Word ou Excel, com dados compilados do livro. Demora de 4 a 8 horas mensais por unidade.

---

## 6. Dores dos Armeiros

1. **Sem prova de entrega:** se o militar disser que não pegou a arma, o armeiro não tem como provar que entregou
2. **Livro ilegível:** escrita de outros armeiros ilegível, campos incompletos, rasuras
3. **Passagem ansiogênica:** o armeiro que assume pode ser responsabilizado por divergência que já existia; sem prova do estado anterior
4. **Horas extras não registradas:** armeiro fica esperando militar que não voltou no horário; sem registro disso no sistema
5. **Chamadas de última hora:** militar liga pedindo saída urgente; armeiro tem que ir pessoalmente ou confiar no colega
6. **Sem notificação:** armeiro não sabe quantas cautelas estão abertas, quem está com o quê, sem precisar checar o livro
7. **Erro humano em quantidade:** confundir quantidade emitida vs. devolvida; erro no livro descoberto meses depois
8. **Sem histórico individual de material:** para saber o histórico de uma arma específica, precisa folhear o livro inteiro

---

## 7. Dores dos Administradores

1. **Sem visibilidade remota:** só descobre problema quando o armeiro reporta ou quando algo sai na corregedoria
2. **Relatório manual mensal:** gasta 4-8h/mês compilando livros físicos em planilhas
3. **Inventário anual demorado:** mobiliza efetivo por dias para contar carga; resultado em ata em papel
4. **Sem rastreabilidade de quem fez o quê:** "o livro estava assim quando cheguei" é argumento suficiente hoje
5. **Gestão de acessos manual:** criar, suspender ou revogar acesso de militar é processo burocrático e manual
6. **Sem métricas:** não sabe quantas saídas por turno, qual material é mais solicitado, qual militar usa mais
7. **Convites manuais:** enviar credenciais para novo militar é processo manual e inseguro
8. **Sem alerta de anomalia:** militar com 3 cautelas abertas não é flagrado automaticamente

---

## 8. Dores do Comando

1. **Zero conformidade em tempo real:** para saber o estado da reserva, precisa pedir relatório ao administrador
2. **Sem visão de exceções:** não vê automaticamente passagens em atraso, cautelas vencidas, divergências abertas
3. **Prestação de contas reactiva:** só descobre problema quando inquérito já está instaurado
4. **Sem comparação entre unidades:** com múltiplas reservas, não há forma de comparar conformidade
5. **Relatório de corregedoria é oneroso:** qualquer solicitação de auditoria implica mobilizar equipe para vasculhar livros
6. **Não consegue provar que não houve irregularidade:** a ausência de prova é a ausência de defesa

---

## 9. Dores da Auditoria / Corregedoria / Controle Interno

1. **Logs falsificáveis:** livro físico pode ser alterado, rasurado, reescrito; sem prova de integridade
2. **Sem trilha de acesso:** não sabe quem acessou o que e quando — apenas o resultado final consta no livro
3. **Evidência não admissível:** fotografia de livro é contestável; assinatura em papel é questionável sem perito
4. **Auditoria presencial obrigatória:** cada auditoria exige deslocamento à unidade e horas de levantamento manual
5. **Sem cadeia de custódia digital:** não há como provar que determinada arma esteve em determinado lugar em determinado horário com certeza criptográfica
6. **LGPD desconhecida:** dados de militares (biometria, histórico de armamento, localização) tratados sem base legal documentada

---

## 10. Jobs to Be Done

| # | JTBD | Quem | Frequência |
|---|---|---|---|
| JT01 | **Controlar** — saber em tempo real qual material está com quem, onde e desde quando | Armeiro, Admin, Comando | Diária |
| JT02 | **Provar** — ter evidência irrefutável de que determinado material foi entregue, recebido e devolvido por pessoas específicas em horário específico | Armeiro, Admin, Corregedoria | A cada cautela |
| JT03 | **Auditar** — rastrear qualquer ação no sistema com trilha imutável, com antes/depois, ator, ip e timestamp | Corregedoria, Controle Interno | Sob demanda |
| JT04 | **Assinar** — dar validade jurídica a documentos (cautela, passagem, inventário) sem papel, sem deslocamento físico e com prova criptográfica | Armeiro, Militar | A cada operação |
| JT05 | **Inventariar** — conferir periodicamente a carga da unidade e gerar relatório assinado de conformidade | Admin, Armeiro | Mensal/trimestral |
| JT06 | **Escalar** — adicionar novas unidades, novos tenants, novos roles sem reescrever código nem duplicar banco | Operador da Plataforma | A cada nova venda |

---

## 11. Casos de Uso Principais

| # | Caso de Uso | Atores | Módulo |
|---|---|---|---|
| UC01 | Militar solicita armamento remotamente com TOTP | Militar, Armeiro | SSA |
| UC02 | Armeiro aprova ou rejeita solicitação com nota | Armeiro | SSA |
| UC03 | Armeiro emite cautela com autenticação forte | Armeiro | Cautela |
| UC04 | Militar confirma recebimento de material assinando eletronicamente | Militar | Cautela |
| UC05 | Armeiro registra devolução; sistema detecta divergência se quantidade diferente | Armeiro | Cautela |
| UC06 | Armeiro que sai inicia passagem de serviço; sistema monta snapshot automático do turno | Armeiro (saindo) | Livro Digital |
| UC07 | Armeiro que entra revisa, assume e assina passagem (com ou sem divergência) | Armeiro (entrando) | Livro Digital |
| UC08 | Admin cria campanha de inventário periódico; unidades conferem e assinam | Admin, Armeiro | Inventário |
| UC09 | Comando acessa dashboard de exceções: passagens em atraso, cautelas vencidas, divergências | Comandante | Dashboard |
| UC10 | Superadmin provisiona novo tenant e configura unidades via Nexus | Superadmin | Nexus |
| UC11 | Admin exporta relatório de movimentação mensal com hash verificável e assinatura | Admin | Relatórios |
| UC12 | Corregedoria consulta audit log de qualquer ação com prova de integridade | Auditor | Auditoria |

---

## 12. Casos de Uso Fora do Escopo

Os seguintes casos de uso estão **explicitamente fora do escopo** do MVP e das Fases 0-12:

| Fora do Escopo | Justificativa |
|---|---|
| Estoque de almoxarifado genérico (caneta, papel, material de escritório) | Outro produto; não é bem sensível |
| Gestão de pessoal / RH / ponto eletrônico | Outro sistema; integração futura via API |
| Folha de pagamento | Fora do domínio |
| ERP de compras e licitações | Outro produto |
| Controle de acesso físico (catraca, portão) | Integração futura, não core |
| Videomonitoramento | Outro domínio |
| Gestão de viaturas (odômetro, manutenção) | Extensão futura, não no MVP |
| Comunicação interna (chat, e-mail institucional) | Outro produto |
| Gestão de escala de serviço | Integração futura |
| Assinatura Gov.br / ICP-Brasil | Fase 4+ como extensão plugável; não no MVP |
| App mobile nativo (iOS/Android) | PWA supre o MVP; app nativo é roadmap pós-piloto |
| Integração com SINESP, SINAM ou sistemas legados | Fase 12 (API pública) |
| Relatório automático por WhatsApp ou e-mail (Resend) | Fase 9 |
| Importação em massa via CSV/XLSX | Fase após piloto; não crítico para o MVP |

---

## 13. Personas

### P1 — Armeiro (Operador da Reserva)
**Papel:** executa saídas, devoluções, biometria, passagem de serviço  
**Frequência de uso:** múltiplas vezes ao dia  
**Dispositivo:** desktop na reserva + eventual mobile  
**Motivações:** processar o fluxo rápido, ter prova do que fez, não ser responsabilizado por erro de colega  
**Frustrações:** ter que preencher campos repetitivos, lentidão de sistema, falta de confirmação do militar  
**Habilidade técnica:** média; usa sistemas simples do dia a dia  
**Rota principal:** `/reserva` — Painel do Armeiro  

### P2 — Militar / Cadete (Usuário Final)
**Papel:** solicita armamento, assina recebimento, reporta ocorrências  
**Frequência de uso:** 1-3x por semana  
**Dispositivo:** smartphone pessoal  
**Motivações:** conseguir o material rapidamente, sem burocracia presencial  
**Frustrações:** ter que ir pessoalmente, filas, sistema lento no celular  
**Habilidade técnica:** média-baixa para sistemas  
**Rota principal:** `/cadete` — Painel do Militar  

### P3 — Admin de Unidade (Administrador da Reserva)
**Papel:** gerencia usuários, arsenal, relatórios da sua unidade  
**Frequência de uso:** diária  
**Dispositivo:** desktop  
**Motivações:** ter controle total da reserva, gerar relatórios rápido, nunca ser pego de surpresa  
**Frustrações:** não ter visibilidade em tempo real, relatórios manuais, gestão de acesso trabalhosa  
**Habilidade técnica:** média-alta  
**Rota principal:** `/admin` — Painel do Administrador  

### P4 — Admin Global (Administrador do Tenant)
**Papel:** gerencia múltiplas unidades do mesmo órgão, provisiona admins de unidade  
**Frequência de uso:** semanal  
**Dispositivo:** desktop  
**Motivações:** visão consolidada de todas as unidades, conformidade geral  
**Habilidade técnica:** alta  
**Rota principal:** dashboard consolidado (a criar em Fase 7)  

### P5 — Comandante (Visão Executiva)
**Papel:** consome dashboard de exceções e conformidade; não opera  
**Frequência de uso:** diária (consumo passivo)  
**Dispositivo:** tablet ou desktop  
**Motivações:** não ser surpreendido, ter argumento para decisões administrativas  
**Habilidade técnica:** baixa — quer visualização, não formulários  
**Rota principal:** `/admin/comando` — Dashboard de Comando (Fase 7)  

### P6 — Auditor / Corregedoria (Controle Externo)
**Papel:** consulta logs de auditoria, exporta trilhas, verifica integridade de documentos  
**Frequência de uso:** sob demanda (auditoria)  
**Dispositivo:** desktop  
**Motivações:** ter evidência admissível, rastrear qualquer ação até o ator  
**Habilidade técnica:** média; sabe o que quer mas não sabe como sistema funciona internamente  
**Rota principal:** módulo de auditoria + exportação (Fase 3+)  

### P7 — Superadmin (Operador da Plataforma)
**Papel:** provisiona tenants, monitora saúde do sistema, intervém em incidentes  
**Frequência de uso:** semanal ou sob demanda  
**Dispositivo:** desktop  
**Motivações:** não ter que ligar para banco de dados manualmente, ter visão de saúde centralizada  
**Habilidade técnica:** alta (técnico)  
**Rota principal:** `/nexus` — Nexus Super Admin  

---

## 14. Fluxos Críticos

### FC01 — Solicitação Remota de Armamento (SSA)
```
Militar solicita via app (TOTP opcional) 
→ Armeiro recebe notificação push 
→ Armeiro aprova com nota opcional 
→ Solicitação expira em 6h se não retirada 
→ Militar retira presencialmente, armeiro registra saída
```

### FC02 — Cautela Eletrônica
```
Armeiro emite cautela (material + militar + quantidade + TOTP)
→ Sistema verifica disponibilidade 
→ Hash documental gerado 
→ Armeiro assina eletronicamente
→ Militar recebe notificação e confirma recebimento com TOTP
→ Cautela ativa; PDF gerado
→ Armeiro registra devolução
→ Sistema detecta divergência se qtd ≠ 
→ PDF fechado com assinaturas
```

### FC03 — Passagem de Serviço Digital
```
Armeiro saindo inicia passagem
→ Sistema monta snapshot (carga, cautelas abertas, movimentos do turno)
→ Armeiro saindo assina com TOTP
→ Armeiro entrante recebe push urgente
→ Armeiro entrante revisa; assume em conformidade OU com observação OU com divergência
→ Armeiro entrante assina
→ PDF gerado com dupla assinatura
```

### FC04 — Inventário Periódico
```
Admin cria campanha com escopo e prazo
→ Unidades recebem notificação
→ Armeiro de cada unidade confere item por item
→ Divergências exigem justificativa (+ foto se configurado)
→ Responsável da unidade assina relatório parcial
→ Admin consolida todas as unidades
→ Admin assina relatório final
→ PDF assinado e verificável por QR Code
```

### FC05 — Autenticação com 2FA
```
Login (email/matrícula + senha)
→ Supabase Auth valida
→ BFF cria iron-session (8h TTL)
→ Operações sensíveis: TOTP obrigatório (Armeiro, Admin)
→ Nexus: 2FA separado com session independente (2h TTL)
```

---

## 15. Proposta de Valor

**Para o Armeiro:** nunca mais ser responsabilizado por algo que não fez. Cada ação tem prova criptográfica com timestamp, IP e autenticação forte.

**Para o Admin:** visibilidade em tempo real sem precisar ligar para ninguém. Relatório mensal em 2 cliques, não 4 horas.

**Para o Comando:** dashboard de exceções — só vê o que precisa de atenção. Conformidade da reserva em um painel, não em um relatório PDF que chega uma semana depois.

**Para a Corregedoria:** trilha imutável de qualquer ação, com antes/depois, ator, IP, timestamp e hash verificável. Evidência admissível em processo administrativo.

**Para o Órgão:** eliminação de risco jurídico de "material desaparecido sem prova". Processo de prestação de contas auditável a qualquer momento, sem mobilização de equipe.

**Frase de posicionamento:** "Sua reserva de armamento, documentada e verificável. Sempre."

---

## 16. Métricas de Sucesso

### Métricas de adoção (piloto)
| Métrica | Meta (90 dias de piloto) |
|---|---|
| % cautelas registradas digitalmente | ≥ 95% |
| % passagens de serviço assinadas digitalmente | ≥ 90% |
| Tempo médio para emitir uma cautela | ≤ 3 minutos |
| Tempo médio de passagem de serviço (início ao aceite) | ≤ 15 minutos |
| % solicitações SSA vs. presencial | ≥ 40% |
| Conformidade de inventário (% itens verificados) | ≥ 98% |

### Métricas de produto
| Métrica | Meta |
|---|---|
| Uptime | ≥ 99,5% |
| Latência p95 das chamadas BFF | ≤ 800ms |
| Testes E2E passando | 100% |
| Incidentes de segurança P0 | 0 |
| Tempo médio de resolução de suporte | ≤ 4 horas |

### Métricas de negócio (pós-piloto)
| Métrica | Meta (12 meses) |
|---|---|
| Tenants ativos | ≥ 3 |
| NPS do piloto | ≥ 50 |
| Tempo para onboarding de novo tenant | ≤ 2 dias |

---

## 17. Riscos de Adoção

| # | Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|---|
| RA01 | Resistência cultural ao digital — "o livro sempre funcionou" | Alta | Alto | Demonstração ao comando mostrando risco jurídico do modelo atual |
| RA02 | Infraestrutura precária — internet instável, PCs lentos | Média | Médio | PWA offline-first parcial; tabela de requisitos mínimos documentada |
| RA03 | Falta de dispositivos para militares | Média | Alto | BYOD (smartphone pessoal); testar em dispositivos Android de 2020+ |
| RA04 | Processo de licitação demorado | Alta | Médio | Piloto zero como prova de conceito gratuita; contratação como SaaS evita licitação |
| RA05 | Turnover de armeiros — treinamento constante | Alta | Médio | UX mínima de fricção; onboarding em ≤ 30 minutos |
| RA06 | Desconfiança com dado biométrico | Média | Alto | Comunicação clara: template armazenado localmente no BFF, nunca na nuvem de terceiros |
| RA07 | Exigência de ICP-Brasil para assinatura | Baixa | Alto | Documentar admissibilidade de assinatura Nível 1 em processos administrativos; ICP como Fase 4+ |
| RA08 | Requisito de dados em solo brasileiro | Média | Alto | Fase 11 (Cloud Run sa-east-1) resolve; comunicar plano desde o início |

---

## 18. Requisitos Funcionais

| # | Requisito | Prioridade | Fase |
|---|---|---|---|
| RF01 | Autenticação por email/matrícula + senha com Supabase Auth | Crítico | ✅ Completo |
| RF02 | TOTP RFC 6238 com anti-replay e rate limit 5/15min | Crítico | ✅ Completo |
| RF03 | Biometria ZKTeco 1:N para identificação | Crítico | ✅ Completo |
| RF04 | Solicitação remota de material (SSA) com aprovação e expiração 6h | Crítico | ✅ Completo |
| RF05 | Controle de saídas e devoluções de material | Crítico | ✅ Completo |
| RF06 | Notificações push via Web Push | Alto | ✅ Completo |
| RF07 | Painel super admin (Nexus) com 2FA isolado e realtime audit | Alto | ✅ Completo |
| RF08 | Multi-tenant real com tenant_id em todas as tabelas e RLS | Crítico | ✅ Fase 1 — Concluído |
| RF09 | RBAC com 6 roles institucionais (superadmin, admin_global, admin_reserva, armeiro, usuario, auditor) | Crítico | ✅ Fase 2 — Concluído |
| RF10 | Auditoria imutável com hash encadeado SHA-256, before/after, actor, IP | Crítico | ✅ Fase 3 — Concluído |
| RF11 | Assinatura eletrônica Nível 1 (TOTP + hash documental + prova criptográfica) | Crítico | ✅ Fase 4 — Concluído |
| RF12 | Cautela eletrônica com status machine completa, assinatura dupla, PDF | Crítico | ✅ Fase 5 — Concluído |
| RF13 | Passagem de serviço digital com snapshot automático e assinatura dupla | Crítico | ✅ Fase 6 — Concluído |
| RF14 | Dashboard de comando por exceção com 14 cards de conformidade | Alto | ✅ Fase 7 — Concluído |
| RF15 | Inventário periódico com campanhas, conferência por unidade e relatório assinado | Alto | ✅ Fase 8 — Concluído |
| RF16 | E-mails transacionais via Resend (invite, TOTP, pendências) | Médio | ❌ Fase 9 — Pendente |
| RF17 | Workflow de desprovisionamento de usuário com cascata de revogação | Alto | ✅ Completo |
| RF18 | Exportação de relatórios PDF com hash verificável e QR Code | Alto | ✅ Completo (Fases 5-8) |
| RF19 | Importação em massa via CSV (militares, unidades, carga) | Médio | Pós-piloto |
| RF20 | API pública versionada v1 com escopos e HMAC webhooks | Baixo | Fase 12 |
| RF21 | Onboarding enterprise de tenant via Nexus (simples + estruturado) | Alto | ✅ Fase 7B — Concluído |
| RF22 | Branding dinâmico por tenant (logo, cores primárias/secundárias) | Alto | ✅ Fase 7B — Concluído |
| RF23 | Livro Digital de Serviço (service_shifts + log de eventos) | Crítico | ✅ Fase 6B — Concluído |
| RF24 | Invite com Privilege Ceiling — hierarquia de convite por role | Alto | ⏳ Fase 7C — Em andamento |
| RF25 | SSO Google via OAuth2 (qualquer convidado pode logar com Google) | Alto | ✅ Completo |

---

## 19. Requisitos Não Funcionais

| # | Requisito | Valor |
|---|---|---|
| RNF01 | Uptime | ≥ 99,5% (excluindo manutenção programada) |
| RNF02 | Latência p95 (BFF) | ≤ 800ms |
| RNF03 | Latência p95 (frontend) | ≤ 2.000ms (First Contentful Paint) |
| RNF04 | Suporte a dispositivos | Android 8+, iOS 13+, Chrome 90+, Safari 14+, Edge 90+ |
| RNF05 | Responsividade | Mobile-first; breakpoints 375px, 768px, 1024px, 1280px |
| RNF06 | Offline-first parcial | Leitura de dados em cache ServiceWorker; mutations requerem conexão |
| RNF07 | Backup | Supabase PITR (point-in-time recovery) ativo; backup diário confirmado |
| RNF08 | Retenção de logs | `audit_logs` / `audit_events`: 5 anos mínimo |
| RNF09 | Escalabilidade | Suportar 50 tenants × 500 usuários sem degradação |
| RNF10 | Acessibilidade | WCAG 2.1 AA mínimo em fluxos críticos |

---

## 20. Requisitos de Segurança

| # | Requisito | Implementação |
|---|---|---|
| RS01 | Autenticação forte obrigatória para operações sensíveis | TOTP RFC 6238 com anti-replay |
| RS02 | Service role key nunca no cliente | Apenas em `apps/bff/src/services/supabase.ts` |
| RS03 | Sessão httpOnly com TTL | iron-session, `apmcb_session` cookie, 8h |
| RS04 | CSRF duplo token (cookie + header) em mutations | `apps/bff/src/middleware/csrf.ts` |
| RS05 | Rate limiting sliding window por IP | 3 níveis: 5/15min, 100/min, 120/min |
| RS06 | CSP estrita sem unsafe-eval | `apps/web/src/middleware.ts` |
| RS07 | RLS em todas as tabelas sensíveis | `supabase/migrations/` — policies por role e tenant |
| RS08 | TOTP anti-replay via `last_used_token` | `supabase/migrations/20260614000004_totp_antireplay.sql` |
| RS09 | Biometric templates com criptografia em repouso | Fase 3 (AES-256 antes de INSERT) |
| RS10 | Nenhum dado sensível em logs | Auditoria logando apenas IDs e ações, nunca credenciais |
| RS11 | Desprovisionamento imediato de usuário | Revogar sessão + bloquear login + audit log |
| RS12 | Isolamento de sessão do Nexus | Session separada com TTL de 2h; role admin + nexusAuthorized |

---

## 21. Requisitos de Auditoria

| # | Requisito | Status |
|---|---|---|
| RA01 | Todo evento sensível gera registro em audit_events | Fase 3 |
| RA02 | Cada evento tem before_snapshot e after_snapshot | Fase 3 |
| RA03 | Hash SHA-256 encadeado em cada evento | Fase 3 |
| RA04 | Registro de actor_id, actor_role, tenant_id, ip, user_agent, device_id | Fase 3 |
| RA05 | Imutabilidade garantida via RULE SQL no_update/no_delete | Fase 3 |
| RA06 | Documento assinado nunca alterado — apenas retificado com novo evento | Fase 4 |
| RA07 | Exportações registradas em audit_events | Fase 5+ |
| RA08 | Login bem-sucedido e falho registrados | Fase 3 |
| RA09 | Verificação de integridade da cadeia de hash disponível | Fase 3 |
| RA10 | Trilha acessível ao auditor via role=auditor | Fase 2 |

---

## 22. Requisitos de UX Operacional

Derivados do princípio "mínimo de fricção" do `CLAUDE.md`:

| # | Requisito |
|---|---|
| UX01 | Ação principal acessível em ≤ 2 cliques a partir da tela inicial do role |
| UX02 | Feedback visual imediato após toda ação (toast, badge, cor) |
| UX03 | Formulários com campos opcionais ao mínimo; o que pode ser inferido é auto-preenchido |
| UX04 | Contadores em tempo real nos cards de painel eliminam navegação desnecessária |
| UX05 | Dialogs de confirmação apenas para ações destrutivas ou irreversíveis |
| UX06 | Estado vazio com orientação de próximo passo (não apenas "nenhum registro") |
| UX07 | Loading states em todos os async actions (Loader2 animate-spin) |
| UX08 | Mobile-first: fluxo do armeiro funcional em smartphone 375px |
| UX09 | Modo escuro institucional como único tema — sem alternância de tema |
| UX10 | Linguagem institucional formal mas direta — sem jargão técnico em telas de operador |

---

## 23. Requisitos de Documentação

| # | Requisito | Fase |
|---|---|---|
| RD01 | Todo documento assinado tem hash SHA-256 verificável | Fase 4 |
| RD02 | PDF gerado para cautela, passagem e inventário | Fases 5-8 |
| RD03 | QR Code em PDFs apontando para verificação pública | Fase 5+ |
| RD04 | Rota pública `/v/[document_id]?hash=[hash]` retorna status de validade | Fase 4 |
| RD05 | Retificação de documento gera novo documento, não altera o original | Fase 4 |
| RD06 | PDF armazenado em Supabase Storage com path auditável | Fase 5+ |
| RD07 | Hash do arquivo armazenado junto com o arquivo (never trust storage alone) | Fase 5+ |

---

## 24. Critérios para MVP Institucional

Para o sistema ser apresentável a um comando e operável em piloto:

| # | Critério | Fase que entrega |
|---|---|---|
| MVP01 | Autenticação forte (TOTP) funcionando para todos os roles | ✅ Completo |
| MVP02 | Solicitação remota de material (SSA) com aprovação e rastreabilidade | ✅ Completo |
| MVP03 | Cautela eletrônica com assinatura dupla e PDF verificável | ✅ Completo (Fase 5) |
| MVP04 | Livro Digital de Serviço com passagem assinada e snapshot automático | ✅ Completo (Fase 6/6B) |
| MVP05 | Dashboard de exceções para o comando | ✅ Completo (Fase 7) |
| MVP06 | Inventário periódico com conformidade assinada | ✅ Completo (Fase 8) |
| MVP07 | Onboarding de tenant via Nexus em ≤ 2 dias | ✅ Completo (Fase 7B) |

**Status MVP:** ✅ **MVP Institucional completo** — UC01 a UC09 funcionam ponta a ponta. Sistema pronto para piloto operacional e segundo tenant.

**Definição de MVP institucional completo:** quando UC01 a UC09 funcionam ponta a ponta com dados reais e todas as assinaturas têm prova criptográfica.

---

## 25. Critérios para Produto Enterprise

Para vender para um segundo tenant e operar em escala:

| # | Critério | Fase que entrega |
|---|---|---|
| ENT01 | Multi-tenant real com isolamento RLS por tenant_id | ✅ Fase 1 |
| ENT02 | RBAC com 6 roles institucionais e matriz completa de permissões | ✅ Fase 2 |
| ENT03 | Auditoria imutável com hash encadeado e before/after | ✅ Fase 3 |
| ENT04 | Assinatura eletrônica Nível 1 com prova criptográfica | ✅ Fase 4 |
| ENT05 | Inventário periódico com conformidade por unidade | ✅ Fase 8 |
| ENT06 | E-mails transacionais (convite, TOTP, notificações) | ❌ Fase 9 — Pendente |
| ENT07 | Onboarding de tenant em ≤ 2 dias via Nexus | ✅ Fase 7B |
| ENT08 | Deprovisionamento de usuário imediato com cascata | ✅ Completo |
| ENT09 | BFF em solo brasileiro (LGPD) | Fase 11 — Pós-venda |
| ENT10 | API pública v1 para integrações externas | Fase 12 — Pós-venda |
| ENT11 | Invite com Privilege Ceiling (hierarquia por role) | ⏳ Fase 7C |
| ENT12 | Nexus: convidar admin_global + editar structure_mode pós-criação | ⏳ Fase 7C |

---

---

## 26. Estado Atual do Sistema (2026-06-30)

### Fases concluídas

| Fase | Nome | Data | Evidência |
|---|---|---|---|
| 0 | Baseline e Governança | 2026-06-18 | `docs/enterprise/reports/phase-1-final-report.md` |
| 1 | Multi-tenant Foundation | 2026-06-22 | 14/14 ✅ — `20260620000001_multitenant_foundation.sql` |
| 2 | RBAC Enterprise | 2026-06-22 | 10/10 ✅ — `20260622000002_rbac_roles.sql` |
| 3 | Audit Events com Hash | 2026-06-22 | 7/7 ✅ — `20260622000003_audit_events.sql` |
| 4 | Assinatura Eletrônica | 2026-06-25 | 6/6 ✅ — `20260620000004_document_signatures.sql` |
| 5 | Cautela Eletrônica | 2026-06-25 | 8/8 ✅ — `20260620000005b_cautelamentos.sql` |
| 5B | Nexus Enterprise | 2026-06-25 | NE01-NE16 ✅ — `20260625000001_nexus_enterprise.sql` |
| 6 | Livro Digital de Serviço (handovers) | 2026-06-26 | 8/8 ✅ — `20260620000006_service_handovers.sql` |
| 6B | Livro Digital (service_shifts + log) | 2026-06-28 | ✅ — `20260628000002_service_shifts_livro_digital.sql` |
| 7 | Dashboard de Comando | 2026-06-27 | 15/15 ✅ |
| 7B | Onboarding Enterprise + Branding + Stress | 2026-06-28 | OB+BR+SO ✅ |
| 8 | Inventário Periódico | 2026-06-27 | ✅ — `20260628000001_inventory.sql` + report |
| pm-A | Segurança — 6 fixes críticos | 2026-06-26 | ✅ |
| pm-B | Qualidade de Dados — RLS por role | 2026-06-26 | ✅ |
| pm-C | UX Operacional — role revalidation + CI/CD | 2026-06-26 | ✅ |
| pm-D | Auditoria Formal — PDF QR + unit tests | 2026-06-27 | 15/15 ✅ |

### Pendente (próximas fases)

| Fase | Nome | Status |
|---|---|---|
| **7C** | Security patches + RBAC Invite Privilege Ceiling | ⏳ Em andamento |
| **9** | E-mail Transacional (Resend) | ❌ Pós-piloto |
| **10** | Hardening Enterprise | ❌ Pós-piloto |
| **11** | Migração Infra Brasil (LGPD) | ❌ Pós-venda |
| **12** | API Segura + Webhooks | ❌ Pós-venda |

### Bugs conhecidos (a corrigir na Fase 7C)

| Bug | Localidade | Impacto |
|---|---|---|
| `requireNexusSession` permite `admin_global` | `apps/bff/src/routes/nexus.ts:21` | admin_global acessa Nexus — bloqueio de segurança |
| `material_availability` sem `security_invoker` | Migration `20260629000002` desfez o fix de `20260629000007` | View não respeita RLS do chamador |
| Endpoints de invite ausentes | BFF nexus + admin | Superadmin não consegue convidar admin_global via UI |

---

*PRD gerado em: 2026-06-20 — Atualizado em: 2026-06-30*  
*Documento base para execução enterprise — não alterar sem aprovação do arquiteto principal*
