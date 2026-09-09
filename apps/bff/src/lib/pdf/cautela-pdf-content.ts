// Conteúdo puro (sem pdf-lib, sem Supabase) do Termo de Cautela — extraído
// para teste unitário via `node --test`.
import { fmtCivilDate } from "./pdf-dates.ts";

export type SignatureAuthInfo =
  | { biometric_verified?: boolean | null; totp_verified?: boolean | null }
  | null
  | undefined;

// Bug 2: a seção "ASSINATURAS" do PDF desenhava as linhas mas nunca dizia
// COMO cada parte assinou. document_signatures carrega `biometric_verified`
// / `totp_verified` (exatamente um é true por assinatura). Fallback para
// "Código Dinâmico" garante que a linha NUNCA fica em branco, mesmo para
// linhas legadas onde nenhuma das flags foi gravada.
export function signatureMethodLabel(sig: SignatureAuthInfo): string {
  return sig?.biometric_verified ? "Assinado via Biometria" : "Assinado via Código Dinâmico";
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
