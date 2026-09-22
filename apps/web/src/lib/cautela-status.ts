// Uma cautela só é "Ativa" com AS DUAS assinaturas (acautelador + acautelado).
// O `status` cru do banco vira "ativa" já na emissão e só muda para um estado
// terminal (devolvida/substituida/cancelada) — nunca reflete a pendência de
// assinatura (nenhuma rota do BFF ou RPC grava status='em_revisao'; ver
// POST /:id/sign-armeiro e /:id/sign-militar em
// apps/bff/src/routes/cautelamentos.ts, que só atualizam
// armeiro_signature_id/militar_signature_id). Enquanto qualquer assinatura
// estiver pendente, o status EXIBIDO e FILTRADO é "em_revisao". SSOT
// compartilhada entre /efetivo/minhas-cautelas e /reserva/cautelas — antes só
// a primeira tinha esse fix, e a segunda mostrava "Ativa" (verde) junto de
// "Aguard. sua assinatura" (achado 2026-09-22).
export function deriveCautelaDisplayStatus(
  c: { status: string; armeiro_signature_id?: string | null; militar_signature_id?: string | null }
): string {
  if (c.status === "ativa" && (!c.armeiro_signature_id || !c.militar_signature_id)) {
    return "em_revisao";
  }
  return c.status;
}
