-- Biometric Bridge Phase 1C — persiste device_detected/device_model do heartbeat
--
-- Achado real (spec docs/superpowers/specs/2026-07-21-biometric-bridge-
-- phase1c-client-design.md, seção 2.3, herdado da spec 1B seção 8):
-- POST /api/biometric-bridge/heartbeat já valida device_detected/
-- device_model pelo schema Zod desde a Fase 1B, mas nunca persistia —
-- sem coluna, sem consumidor de UI. Um armeiro não tinha como saber
-- "leitor desconectado do USB, mas processo do bridge ainda rodando"
-- sem abrir o Bridge Client localmente no PC da reserva.
alter table biometric_devices
  add column if not exists device_detected boolean,
  add column if not exists device_model text;

comment on column biometric_devices.device_detected is
  'Último valor reportado pelo heartbeat do bridge — leitor NITGEN detectado via USB no momento do heartbeat mais recente. NULL = nunca reportado (device pareado mas sem heartbeat ainda).';
comment on column biometric_devices.device_model is
  'Modelo do leitor NITGEN reportado pelo bridge (ex: "Hamster Plus"), quando o SDK expõe essa informação.';
