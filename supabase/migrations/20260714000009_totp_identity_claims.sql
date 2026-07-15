-- Consumo único real para identificação TOTP em fluxos de custódia.
--
-- Achado de code review (2ª rodada, 2026-07-15): limpar session.pendingIdentity
-- após sucesso (fix anterior) não é atômico — iron-session vive no cookie,
-- não no servidor, então duas requisições verdadeiramente paralelas com o
-- mesmo cookie ainda-não-atualizado liam e validavam o MESMO pendingIdentity
-- simultaneamente, permitindo 2+ movimentações distintas autorizadas por um
-- único código TOTP. A prova biométrica já não tinha esse problema porque o
-- consumo é uma constraint UNIQUE no banco (biometric_proof_consumptions),
-- travada dentro da própria transação da RPC — este fix aplica o mesmo
-- padrão para TOTP.
--
-- "purpose" não é fixado na criação do claim (POST /api/lendings/identify é
-- compartilhado pelos fluxos de nova saída E devolução — a intenção só fica
-- clara depois, quando o armeiro escolhe a ação na UI). A segurança do claim
-- vem de tenant/reserve/actor/profile/janela de 2min/consumo único por
-- operation_id — não precisa também travar por propósito declarado com
-- antecedência.

create table if not exists totp_identity_claims (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id),
  reserve_id            uuid not null references reserves(id),
  actor_id              uuid not null references profiles(id),
  profile_id            uuid not null references profiles(id),
  purpose               text,
  consumed_operation_id uuid,
  created_at            timestamptz not null default now()
);

alter table totp_identity_claims enable row level security;

create index if not exists idx_totp_identity_claims_scope
  on totp_identity_claims(tenant_id, reserve_id, created_at desc);

comment on table totp_identity_claims is
  'Claim de identificação TOTP de curta duração (2min), criado por POST /api/lendings/identify. Consumido atomicamente (travado FOR UPDATE) dentro da RPC que registra a movimentação — consumed_operation_id rastreia qual movement_id/operation_id já usou este claim, permitindo retry idempotente da MESMA operação mas rejeitando reuso em operação diferente.';
