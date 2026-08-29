import { createClient } from "@supabase/supabase-js";

// ── Padrões que identificam dados criados por testes E2E ──────────────────────
// Convenção obrigatória nos specs:
//   - Usuários temporários: email terminando em @e2e.test  OU matrícula E2E*
//   - Shifts de livro digital: turno "ativo" de um profile identificado acima
//   - Usuários convidados por testes: registration_status='pending' + invited_at set
//     E email contendo '+e2e' ou domínio '@e2e.test'
const E2E_MATRICULA_PREFIX = "E2E";
const E2E_EMAIL_SUFFIX     = "@e2e.test";

export default async function globalTeardown() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Teardown só executa quando vars de ambiente estão presentes.
  if (!supabaseUrl || !serviceKey) {
    console.log("[teardown] sem credenciais — skipping");
    return;
  }

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let cleaned = 0;

  // ── 1. Cancelar material_requests pendentes de testes SSA/stress ──────────
  const { data: canceledReqs } = await db
    .from("material_requests")
    .update({ status: "cancelado", cancelled_at: new Date().toISOString() })
    .in("status", ["pendente", "aprovado"])
    .select("id");
  const reqCount = canceledReqs?.length ?? 0;
  if (reqCount) {
    console.log(`[teardown] material_requests canceladas: ${reqCount}`);
    cleaned += reqCount;
  }

  // ── 2. Remover usuários temporários (E2E* matricula ou @e2e.test email) ────
  const { data: tempProfiles } = await db
    .from("profiles")
    .select("id, matricula, email")
    .or(`matricula.like.${E2E_MATRICULA_PREFIX}%,email.like.%${E2E_EMAIL_SUFFIX}`);

  if (tempProfiles?.length) {
    const ids = tempProfiles.map((p) => p.id);
    // ON DELETE CASCADE limpa: totp_secrets, notifications, reserve_memberships, tenant_memberships
    await db.from("profiles").delete().in("id", ids);
    // Remove da auth.users (requer service_role)
    const delResults = await Promise.allSettled(
      ids.map((id) => db.auth.admin.deleteUser(id))
    );
    const deleted = delResults.filter((r) => r.status === "fulfilled").length;
    console.log(`[teardown] usuários E2E removidos: ${deleted}/${ids.length}`);
    cleaned += deleted;
  }

  // ── 3. Remover usuários invited-pending criados por testes de convite ──────
  // Identifica por: invited_at NOT NULL + registration_status='pending'
  // + email contém '+e2e' (padrão recomendado nos specs de invite)
  // Seguro: nunca afeta usuários reais que possam ter aceito o convite
  const { data: pendingInvites } = await db
    .from("profiles")
    .select("id, email")
    .eq("registration_status", "pending")
    .like("email", "%+e2e%");

  if (pendingInvites?.length) {
    const ids = pendingInvites.map((p) => p.id);
    await db.from("profiles").delete().in("id", ids);
    await Promise.allSettled(ids.map((id) => db.auth.admin.deleteUser(id)));
    console.log(`[teardown] convites pendentes E2E removidos: ${ids.length}`);
    cleaned += ids.length;
  }

  // ── 4. Fechar service_shifts abertos deixados por testes do livro digital ──
  // Schema real (20260628000002_service_shifts_livro_digital.sql): status é
  // 'ativo'|'encerrado'|'encerrado_sem_passagem', coluna é ended_at — não
  // existe "aberto"/"fechado"/"closed_at"/"notes". Essa query nunca bateu
  // com uma linha real (PostgREST rejeita a coluna inexistente e o erro era
  // silenciosamente ignorado) — turnos órfãos de contas de teste ficavam
  // "ativo" indefinidamente, bloqueando a reserva compartilhada via
  // uq_shifts_reserve_ativo para qualquer outro armeiro (causa raiz de uma
  // falha real de CI em 2026-07-15, ver helpers.ts ensureActiveShift).
  // Só fecha turnos de contas de teste conhecidas (matrícula E2E* ou email
  // @e2e.test) — nunca mexe em turno de armeiro real.
  const { data: e2eShiftProfileIds } = await db
    .from("profiles")
    .select("id")
    .or(`matricula.like.${E2E_MATRICULA_PREFIX}%,email.like.%${E2E_EMAIL_SUFFIX}`);

  if (e2eShiftProfileIds?.length) {
    const { data: closedShifts, error: shiftErr } = await db
      .from("service_shifts")
      .update({ status: "encerrado", ended_at: new Date().toISOString() })
      .eq("status", "ativo")
      .in("armeiro_id", e2eShiftProfileIds.map((p) => p.id))
      .select("id");
    if (shiftErr) {
      console.warn("[teardown] falha ao fechar service_shifts órfãos:", shiftErr.message);
    } else {
      const shiftCount = closedShifts?.length ?? 0;
      if (shiftCount) {
        console.log(`[teardown] service_shifts fechados: ${shiftCount}`);
        cleaned += shiftCount;
      }
    }
  }

  // ── 5. Resetar TOTP anti-replay dos usuários fixture ─────────────────────
  // Evita que um teste de lockout bloqueie o próximo run
  const fixtureEmails = [
    "cadete@apmcb.dev",
    "armeiro@apmcb.dev",
    "admin@apmcb.dev",
    "adminreserva@apmcb.dev",
    "auditor@apmcb.dev",
  ];
  const { data: fixtureProfiles } = await db
    .from("profiles")
    .select("id")
    .in("email", fixtureEmails);

  if (fixtureProfiles?.length) {
    const ids = fixtureProfiles.map((p) => p.id);
    await db
      .from("totp_secrets")
      .update({ failure_count: 0, last_failure_at: null, last_used_token: null })
      .in("user_id", ids);
    console.log(`[teardown] TOTP anti-replay resetado para ${ids.length} usuários fixture`);
  }

  // ── 6. Devolver items cautelados por usuários de teste ────────────────────
  // Identifica cautelamentos ativos de usuários E2E (não afeta dados reais)
  //
  // Bug real encontrado (2026-08-18, code review): esta query usava
  // `.eq("status", "cautelado")`/`.in("current_holder_id", ...)` e o UPDATE
  // usava esses mesmos 2 nomes — mas material_items NÃO tem colunas `status`
  // nem `current_holder_id`; os nomes reais são `status_operacional` e
  // `current_holder_user_id` (ver supabase/migrations/20260620000001b_
  // material_items.sql linhas 41 e 53). PostgREST rejeita silenciosamente
  // as colunas inexistentes (erro descartado pela desestruturação `{ data }`
  // sem checar `error`) — a mesma classe de falha já documentada na seção 4
  // acima para service_shifts. Efeito prático: nenhum item cautelado por
  // conta de teste era devolvido aqui desde que este bloco foi escrito;
  // itens ficavam presos em status_operacional='cautelado' indefinidamente,
  // podendo causar flakiness em specs que dependem de estoque disponível.
  // Nota: o trigger trg_validate_item_transition já zera current_holder_
  // user_id automaticamente ao setar status_operacional='disponivel' (linha
  // 111 da mesma migration) — setá-lo aqui também é redundante mas seguro
  // (idempotente) e deixa a intenção explícita no update.
  const { data: e2eUserIds } = await db
    .from("profiles")
    .select("id")
    .or(`matricula.like.${E2E_MATRICULA_PREFIX}%,email.like.%${E2E_EMAIL_SUFFIX}`);

  if (e2eUserIds?.length) {
    const ids = e2eUserIds.map((p) => p.id);
    const { data: cautelados, error: cauteladosErr } = await db
      .from("material_items")
      .select("id")
      .eq("status_operacional", "cautelado")
      .in("current_holder_user_id", ids);
    if (cauteladosErr) {
      console.warn("[teardown] falha ao buscar material_items cautelados de E2E:", cauteladosErr.message);
    }

    if (cautelados?.length) {
      const itemIds = cautelados.map((i) => i.id);
      const { error: updateErr } = await db
        .from("material_items")
        .update({ status_operacional: "disponivel", current_holder_user_id: null })
        .in("id", itemIds);
      if (updateErr) {
        console.warn("[teardown] falha ao devolver material_items de E2E:", updateErr.message);
      } else {
        console.log(`[teardown] items devolvidos de usuários E2E: ${itemIds.length}`);
        cleaned += itemIds.length;
      }
    }
  }

  // ── 7. Desativar categorias criadas por testes de category-requests ───────
  // Achado real de produto (2026-08-17): category-requests.spec.ts sempre
  // nomeia categorias de teste com o prefixo "E2E Categoria " (uniqueCategoryName()),
  // mas nunca existiu limpeza aqui — toda categoria APROVADA por um teste
  // (CATREQ03/SEC-CATREQ05) virava uma linha real e permanente em
  // material_categories, visível pra usuários reais no dropdown de cadastro
  // de material. Rodando esse teste no CI a cada push (contra o ambiente
  // real), isso acumulou 21 categorias vazadas antes de ser descoberto e
  // limpo manualmente. Mesmo soft-delete (active=false) que o botão
  // "Desativar" do admin_reserva já usa — reversível, não é hard delete.
  const E2E_CATEGORY_PREFIX = "E2E Categoria";
  const { data: e2eCategories } = await db
    .from("material_categories")
    .select("id")
    .ilike("nome", `${E2E_CATEGORY_PREFIX}%`)
    .eq("active", true);

  if (e2eCategories?.length) {
    const ids = e2eCategories.map((c) => c.id);
    await db.from("material_categories").update({ active: false }).in("id", ids);
    console.log(`[teardown] categorias E2E desativadas: ${ids.length}`);
    cleaned += ids.length;
  }

  // Solicitações de categoria (category_requests) que nunca chegaram a ser
  // decididas num teste interrompido — mesmo prefixo, evita poluir a fila
  // de aprovação do admin_reserva com pendências órfãs de teste.
  const { data: e2eCategoryRequests } = await db
    .from("category_requests")
    .select("id")
    .ilike("nome", `${E2E_CATEGORY_PREFIX}%`)
    .eq("status", "pendente");

  if (e2eCategoryRequests?.length) {
    const ids = e2eCategoryRequests.map((r) => r.id);
    await db
      .from("category_requests")
      .update({ status: "rejeitado", rejection_reason: "Limpeza automática de teardown E2E" })
      .in("id", ids);
    console.log(`[teardown] category_requests E2E órfãs rejeitadas: ${ids.length}`);
    cleaned += ids.length;
  }

  // ── 8. Cancelar cautelamentos "ativa" criados por testes ──────────────────
  // Achado real do usuário (2026-08-29): a tela real de Cautelas (armeiro
  // fixture, matricula 000002, reaproveitado por TODA a suíte E2E) mostrava
  // 134 linhas "Teste .../E2E .../AVU ..." nunca assinadas, parecendo bug de
  // assinatura ("como assim pendente do armeiro e minha? como assino? houve
  // regressão?"). Não era bug — 6 specs diferentes (cautelamentos-batch,
  // cautelamentos, cautela-eligibility, item-integrity, livro-digital,
  // avu-alertas-vencimento) criam cautelas via /api/cautelamentos(/batch)
  // pra testar o fluxo, NENHUM com cleanup — mesma classe de vazamento já
  // documentada nas seções 6 (items) e 7 (categorias) acima, e igualmente
  // grave: 16 dos 134 eram ITENS REAIS de inventário (Espadim, Quepe de
  // Cerimônia, FUZIL ARAD etc.), travados como status_operacional='cautelado'
  // por uma cautela que nunca existiu de verdade — reduzindo silenciosamente
  // a contagem de "disponíveis para cautela" que usuários reais veem.
  // Convenção obrigatória a partir de agora: todo spec que cria cautela via
  // /api/cautelamentos deve nomear motivo_emissao começando com "Teste "
  // (specs antigos) ou o prefixo do próprio spec em maiúsculas (ex: "AVU02
  // — ...", já usado por avu-alertas-vencimento.spec.ts) — mesma convenção
  // de nomenclatura já usada pros outros recursos limpos aqui.
  const { data: canceladas } = await db
    .from("cautelamentos")
    .update({
      status: "cancelada",
      motivo_cancelamento: "Limpeza automática de teardown E2E",
      cancelada_em: new Date().toISOString(),
    })
    .eq("status", "ativa")
    .or("motivo_emissao.ilike.Teste %,motivo_emissao.ilike.E2E%,motivo_emissao.ilike.AVU%")
    .select("id, item_id");

  if (canceladas?.length) {
    const itemIds = canceladas.map((c) => c.item_id).filter(Boolean);
    if (itemIds.length) {
      await db
        .from("material_items")
        .update({ status_operacional: "disponivel", active_cautelamento_id: null })
        .in("id", itemIds)
        .in("active_cautelamento_id", canceladas.map((c) => c.id));
    }
    console.log(`[teardown] cautelamentos de teste cancelados: ${canceladas.length}`);
    cleaned += canceladas.length;
  }

  console.log(`[teardown] concluído — ${cleaned} registros limpos`);
}
