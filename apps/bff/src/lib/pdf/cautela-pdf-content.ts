// Conteúdo puro (sem pdf-lib, sem Supabase) do Termo de Cautela — extraído
// para teste unitário via `node --test`.
import { fmtCivilDate } from "./pdf-dates.ts";

export type SignatureAuthInfo =
  | { biometric_verified?: boolean | null; totp_verified?: boolean | null }
  | null
  | undefined;

// Bug 2: a seção "ASSINATURAS" do PDF desenhava as linhas mas nunca dizia
// COMO cada parte assinou. document_signatures carrega `biometric_verified`
// / `totp_verified` — nos fluxos atuais de cautela exatamente um é true por
// assinatura (sign-armeiro / sign-militar e a RPC sign_cautelamento_batch).
// Se nenhum for conhecido (linha legada / caminho futuro), usa um rótulo
// NEUTRO — nunca em branco, mas também nunca afirmando uma modalidade que
// não podemos comprovar num documento oficial.
export function signatureMethodLabel(sig: SignatureAuthInfo): string {
  if (sig?.biometric_verified) return "Assinado via Biometria";
  if (sig?.totp_verified) return "Assinado via Código Dinâmico";
  return "Assinatura eletrônica verificada";
}

export interface SignatureRow {
  id: string;
  totp_verified?: boolean | null;
  biometric_verified?: boolean | null;
}

// Pareia os dois signature_id da cautela (armeiro + militar, ambos já
// garantidos não-nulos pelo guard 422 da rota) às linhas de
// document_signatures carregadas. `ok:false` quando a query falhou ou veio
// incompleta — a rota trata como erro em vez de emitir um Termo com
// modalidade inventada.
export function resolveSignatureMethods(
  rows: SignatureRow[] | null | undefined,
  armeiroSignatureId: string,
  militarSignatureId: string,
):
  | { ok: true; signatures: { armeiro: SignatureAuthInfo; militar: SignatureAuthInfo } }
  | { ok: false } {
  const byId = new Map((rows ?? []).map((r) => [r.id, r]));
  const armeiro = byId.get(armeiroSignatureId);
  const militar = byId.get(militarSignatureId);
  if (!armeiro || !militar) return { ok: false };
  return { ok: true, signatures: { armeiro, militar } };
}

export interface CautelaItemForRows {
  numero_serie?: string | null;
  validade_item?: string | null;
  material_type: { nome: string; categoria: string };
}

// Bug 3: a seção de item acautelado não trazia a quantidade. Cada cautela é
// sempre exatamente 1 material_item físico — não existe coluna `quantidade`
// (ver migration 20260821000001: "cada cautela é sempre exatamente 1 item,
// sem conceito de quantidade"). Num documento oficial de custódia a
// quantidade precisa constar explicitamente, ainda que constante.
export function buildCautelaItemRows(
  item: CautelaItemForRows,
  condicaoEmissao: string,
): { label: string; value: string }[] {
  return [
    { label: "Descrição", value: item.material_type.nome },
    { label: "Categoria", value: item.material_type.categoria },
    { label: "Número de série", value: item.numero_serie ?? "—" },
    { label: "Quantidade", value: "1" },
    { label: "Condição na emissão", value: condicaoEmissao },
    { label: "Validade do item", value: fmtCivilDate(item.validade_item) },
  ];
}
