-- Biometric Bridge Phase 1A.2: custody and signature proof linkage.

alter table lendings
  add column if not exists biometric_proof_id uuid references biometric_proofs(id);

alter table biometric_proofs
  add column if not exists template_hash text;

create index if not exists idx_lendings_biometric_proof
  on lendings(biometric_proof_id)
  where biometric_proof_id is not null;

create unique index if not exists uq_lendings_movement_material
  on lendings(movement_id, material_type_id)
  where movement_id is not null;

alter table document_signatures
  add column if not exists biometric_verified boolean not null default false;

comment on column lendings.biometric_proof_id is
  'Immutable biometric proof authorizing this lending operation; never a raw fingerprint template.';
comment on column document_signatures.biometric_verified is
  'Whether the signer supplied a validated biometric proof for this document.';
comment on column biometric_proofs.template_hash is
  'Hash of an enrollment template, signed by the bridge; the template bytes are never part of the proof payload.';
