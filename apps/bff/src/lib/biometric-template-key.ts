// Derivação da chave AES-256-GCM que decifra os templates biométricos
// (biometric_templates.template_data, sincronizados via /templates/sync).
// Ver spec docs/superpowers/specs/2026-07-21-biometric-bridge-phase1c-
// client-design.md, seção 3 — pergunta que a spec 1B deixou em aberto
// ("a chave de decifragem... é decisão do lado do bridge").
//
// HKDF-SHA256(ikm=BIOMETRIC_TEMPLATE_MASTER_KEY, salt=tenant_id,
// info="apmcb-biometric-template-key-v1") — determinístico: qualquer
// bridge pareado no mesmo tenant, em qualquer momento, deriva a MESMA
// chave sem o servidor precisar armazenar nada por-tenant. `info` fica
// FIXO nesta fase (v1, sem interpolação de encryption_key_version — ver
// spec seção 3.2, escopo reduzido: rotação de verdade fica para a Fase 3).
//
// Mesmo padrão de criticidade que TOTP_ENCRYPTION_KEY (memória
// totp_architecture): nesta fase, NUNCA alterar BIOMETRIC_TEMPLATE_
// MASTER_KEY depois de usado em produção — quebra a decifragem de TODOS
// os tenants simultaneamente (sem versionamento ativo nesta fase).

const HKDF_INFO = "apmcb-biometric-template-key-v1";
const DERIVED_KEY_BITS = 256; // AES-256-GCM

// Fail Fast no boot — mesmo padrão de TOTP_ENCRYPTION_KEY (routes/totp.ts):
// sem isso, o servidor sobe normalmente e só falha quando um bridge real
// chamar /tenant-key pela primeira vez, um modo de falha silencioso pior
// do que recusar subir. Só a CHECAGEM de boot é "congelada" no momento do
// import — a leitura de verdade (biometricTemplateMasterKey abaixo) é
// preguiçosa, lendo process.env a cada chamada, mesmo padrão já usado em
// biometric-pairing-code.ts — necessário pra ser testável (setar/limpar a
// env var em runtime) e pra nunca divergir do valor real do processo.
if (!process.env.BIOMETRIC_TEMPLATE_MASTER_KEY && process.env.NODE_ENV === "production") {
  throw new Error("BIOMETRIC_TEMPLATE_MASTER_KEY env var obrigatória em produção");
}

export function biometricTemplateMasterKey(): string {
  const key = process.env.BIOMETRIC_TEMPLATE_MASTER_KEY;
  if (!key) {
    throw new Error("BIOMETRIC_TEMPLATE_MASTER_KEY env var ausente");
  }
  return key;
}

// Retorna a chave derivada como base64 — o bridge decodifica e usa
// diretamente como chave AES-256-GCM (32 bytes). Nunca logar o retorno.
export async function deriveTenantTemplateKey(tenantId: string): Promise<string> {
  const masterKey = biometricTemplateMasterKey();
  const ikm = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(masterKey),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode(tenantId),
      info: new TextEncoder().encode(HKDF_INFO),
    },
    ikm,
    DERIVED_KEY_BITS,
  );
  return Buffer.from(derivedBits).toString("base64");
}
