#!/usr/bin/env node
/**
 * Seed script — dados operacionais realistas para PMPB/APMCB
 * Idempotente: ON CONFLICT DO NOTHING em todos os INSERTs.
 *
 * Uso: node supabase/scripts/seed-operational.mjs
 * Requer: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY no ambiente
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://jepitcrkicwmvzrmllpn.supabase.co";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TENANT_ID    = "f0edc186-693f-4ab0-a0e8-6c18d65876fa"; // PMPB

if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY não definida");
  process.exit(1);
}

const headers = {
  "Content-Type": "application/json",
  "apikey": SERVICE_KEY,
  "Authorization": `Bearer ${SERVICE_KEY}`,
  "Prefer": "resolution=ignore-duplicates",
};

async function post(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: { ...headers, "Prefer": "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`POST ${path} failed:`, res.status, text.slice(0, 200));
    return null;
  }
  return JSON.parse(text);
}

async function get(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers });
  return res.ok ? res.json() : [];
}

async function authPost(path, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.warn(`AUTH POST ${path} failed:`, res.status, text.slice(0, 200));
    return null;
  }
  return JSON.parse(text);
}

// ── Buscar reserve APMCB ────────────────────────────────────────────────────
const reserves = await get(`reserves?tenant_id=eq.${TENANT_ID}&select=id,acronym`);
const apmcb = reserves.find((r) => r.acronym === "APMCB") ?? reserves[0];
if (!apmcb) {
  console.error("Reserve APMCB não encontrada. Execute seed base primeiro.");
  process.exit(1);
}
const RESERVE_ID = apmcb.id;
console.log("Reserve APMCB:", RESERVE_ID);

// ── 10 Tipos de material ─────────────────────────────────────────────────────
const materiais = [
  { nome: "Pistola Taurus PT840", tipo: "arma", calibre: "40 S&W",    unidade: "unidade", quantidade: 50, reserve_id: RESERVE_ID, tenant_id: TENANT_ID },
  { nome: "Pistola Glock G17",    tipo: "arma", calibre: "9mm Luger",  unidade: "unidade", quantidade: 30, reserve_id: RESERVE_ID, tenant_id: TENANT_ID },
  { nome: "Colete Balístico NIJ III", tipo: "epi",     calibre: null,  unidade: "unidade", quantidade: 40, reserve_id: RESERVE_ID, tenant_id: TENANT_ID },
  { nome: "Algema Dupla Articulada", tipo: "material",  calibre: null, unidade: "unidade", quantidade: 100, reserve_id: RESERVE_ID, tenant_id: TENANT_ID },
  { nome: "Lanterna Tática 1000lm",  tipo: "material",  calibre: null, unidade: "unidade", quantidade: 60, reserve_id: RESERVE_ID, tenant_id: TENANT_ID },
  { nome: "Rádio HT Motorola DP4400", tipo: "material", calibre: null, unidade: "unidade", quantidade: 25, reserve_id: RESERVE_ID, tenant_id: TENANT_ID },
  { nome: "Munição Cal. 40 (cx 50)", tipo: "material", calibre: "40 S&W", unidade: "caixa", quantidade: 200, reserve_id: RESERVE_ID, tenant_id: TENANT_ID },
  { nome: "Munição Cal. 9mm (cx 50)", tipo: "material", calibre: "9mm Luger", unidade: "caixa", quantidade: 150, reserve_id: RESERVE_ID, tenant_id: TENANT_ID },
  { nome: "Espargidor de Pimenta",   tipo: "material", calibre: null, unidade: "unidade", quantidade: 80,  reserve_id: RESERVE_ID, tenant_id: TENANT_ID },
  { nome: "Detector de Metais Manual", tipo: "material", calibre: null, unidade: "unidade", quantidade: 15, reserve_id: RESERVE_ID, tenant_id: TENANT_ID },
];

console.log("Inserindo 10 tipos de material...");
const matResult = await post("material_types", materiais);
const insertedMats = matResult ?? [];
console.log(`  ${insertedMats.length} inseridos (restante já existia)`);

// Buscar todos (incluindo já existentes)
const allMats = await get(`material_types?reserve_id=eq.${RESERVE_ID}&select=id,nome&limit=20`);

// ── 20 Militares ─────────────────────────────────────────────────────────────
const POSTOS = ["soldado", "cabo", "terceiro_sargento", "segundo_sargento", "primeiro_sargento", "subtenente", "segundo_tenente", "primeiro_tenente", "capitao"];
const NOMES = [
  "João Silva", "Pedro Costa", "Carlos Souza", "Rafael Lima", "Lucas Alves",
  "Fernando Santos", "Marcos Oliveira", "Diego Ferreira", "Anderson Ribeiro", "Thiago Pereira",
  "Bruno Martins", "Rodrigo Nunes", "Gustavo Barbosa", "Leonardo Castro", "Felipe Rocha",
  "Renato Carvalho", "Caio Nascimento", "Paulo Moreira", "Victor Lopes", "André Araujo",
];

console.log("Criando 20 militares...");
let militaresOk = 0;
for (let i = 0; i < 20; i++) {
  const nome = NOMES[i];
  const matricula = `PM${String(100000 + i).padStart(6, "0")}`;
  const email = `seed.pm${100000 + i}@apmcb.seed`;
  const posto = POSTOS[i % POSTOS.length];

  // Tenta criar auth user
  const authUser = await authPost("admin/users", {
    email,
    password: "Seed@2026!",
    email_confirm: true,
    user_metadata: { nome_completo: nome, matricula },
  });

  if (!authUser?.id) { continue; }

  // Upsert profile
  await post("profiles", [{
    id: authUser.id,
    matricula,
    nome_completo: nome,
    posto,
    role: "usuario",
    registration_status: "active",
    default_tenant_id: TENANT_ID,
  }]);

  // Adicionar à tenant membership
  await post("tenant_memberships", [{ user_id: authUser.id, tenant_id: TENANT_ID }]);

  // Adicionar à reserve membership
  await post("reserve_memberships", [{ user_id: authUser.id, reserve_id: RESERVE_ID, role: "usuario" }]);

  militaresOk++;
}
console.log(`  ${militaresOk} militares criados`);

// ── 30 Cautelas fechadas + 5 abertas ─────────────────────────────────────────
// Buscar usuários membros da reserva (excluindo seed users já feitos)
const profiles = await get(`profiles?default_tenant_id=eq.${TENANT_ID}&role=eq.usuario&select=id&limit=25`);

console.log("Inserindo cautelas...");
if (profiles.length > 0 && allMats.length > 0) {
  const now = new Date();

  // 30 cautelas fechadas (devolvidas)
  const cautelasFechadas = [];
  for (let i = 0; i < 30; i++) {
    const user = profiles[i % profiles.length];
    const mat  = allMats[i % allMats.length];
    const daysAgo = 10 + (i * 2);
    const createdAt = new Date(now.getTime() - daysAgo * 86400000).toISOString();
    const returnedAt = new Date(now.getTime() - (daysAgo - 3) * 86400000).toISOString();
    cautelasFechadas.push({
      user_id: user.id,
      material_type_id: mat.id,
      reserve_id: RESERVE_ID,
      tenant_id: TENANT_ID,
      quantidade: 1,
      status: "devolvida",
      created_at: createdAt,
      returned_at: returnedAt,
      observacoes: `Cautela de teste ${i + 1}`,
    });
  }
  await post("cautelamentos", cautelasFechadas);

  // 5 cautelas abertas
  const abertas = [];
  for (let i = 0; i < 5; i++) {
    const user = profiles[i % profiles.length];
    const mat  = allMats[(i + 3) % allMats.length];
    abertas.push({
      user_id: user.id,
      material_type_id: mat.id,
      reserve_id: RESERVE_ID,
      tenant_id: TENANT_ID,
      quantidade: 1,
      status: "ativa",
      observacoes: `Cautela ativa ${i + 1}`,
    });
  }
  await post("cautelamentos", abertas);
  console.log("  35 cautelas inseridas (30 fechadas + 5 abertas)");
} else {
  console.warn("  Sem usuários ou materiais para criar cautelas");
}

// ── 10 SSA requests ──────────────────────────────────────────────────────────
if (profiles.length > 0 && allMats.length > 0) {
  console.log("Inserindo 10 SSA requests...");
  const statusList = ["pending", "approved", "rejected", "pending", "approved", "expired", "pending", "approved", "rejected", "pending"];
  const ssaItems = [];
  for (let i = 0; i < 10; i++) {
    const user = profiles[i % profiles.length];
    const mat  = allMats[i % allMats.length];
    ssaItems.push({
      requestor_id: user.id,
      material_type_id: mat.id,
      reserve_id: RESERVE_ID,
      tenant_id: TENANT_ID,
      quantidade: 1,
      justificativa: `Solicitação de material ${i + 1} — operação de rotina`,
      status: statusList[i],
    });
  }
  await post("ssa_requests", ssaItems);
  console.log("  10 SSA requests inseridas");
}

// ── 3 Ocorrências ────────────────────────────────────────────────────────────
if (profiles.length > 0 && allMats.length > 0) {
  console.log("Inserindo 3 ocorrências...");
  const ocorrencias = [
    { user_id: profiles[0].id, material_type_id: allMats[0].id, reserve_id: RESERVE_ID, tenant_id: TENANT_ID, descricao: "Material entregue com avaria superficial na coronha", prioridade: "alta", status: "aberta" },
    { user_id: profiles[1 % profiles.length].id, material_type_id: allMats[1 % allMats.length].id, reserve_id: RESERVE_ID, tenant_id: TENANT_ID, descricao: "Colete com rasgo na área lateral direita", prioridade: "media", status: "em_analise" },
    { user_id: profiles[2 % profiles.length].id, material_type_id: allMats[2 % allMats.length].id, reserve_id: RESERVE_ID, tenant_id: TENANT_ID, descricao: "Rádio com bateria sem carga — possível defeito", prioridade: "baixa", status: "aberta" },
  ];
  await post("ocorrencias", ocorrencias);
  console.log("  3 ocorrências inseridas");
}

// ── Verificação final ────────────────────────────────────────────────────────
console.log("\n=== VERIFICAÇÃO PÓS-SEED ===");
const [mCount, cCount, ssaCount, profCount] = await Promise.all([
  get(`material_types?reserve_id=eq.${RESERVE_ID}&select=id`),
  get(`cautelamentos?reserve_id=eq.${RESERVE_ID}&select=id`),
  get(`ssa_requests?reserve_id=eq.${RESERVE_ID}&select=id`),
  get(`profiles?default_tenant_id=eq.${TENANT_ID}&role=eq.usuario&select=id`),
]);
console.log(`  Materiais:  ${mCount.length}`);
console.log(`  Cautelas:   ${cCount.length}`);
console.log(`  SSA:        ${ssaCount.length}`);
console.log(`  Militares:  ${profCount.length}`);
console.log("\n✅ Seed operacional concluído.");
