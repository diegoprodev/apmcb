// SSOT (lado web) para os status_operacional de material_items que representam
// um item "em triagem" — fora de posse ativa (em_saida/cautelado) e fora dos
// estados finais/legados (baixado, inapto).
//
// Cobre os valores adicionados à CHECK constraint de material_items em 2026-07
// (avariado, furtado, em_pericia, bloqueado, em_transito, aguardando_baixa),
// além dos dois originais (manutencao, extraviado). Nota de design: a
// taxonomia de 3 grupos (Danificados/Perdidos/Administrativo) e a regra de
// número de B.O. obrigatório para "furtado" são decisão própria desta
// implementação — não havia uma especificação de campo a campo para isso;
// documentado no relatório final para revisão do dono do produto.
//
// Duplicado (não importado) no lado BFF em apps/bff/src/routes/arsenal.ts —
// mesmo padrão já usado no projeto para material-metadata (web e BFF mantêm
// cópias locais próprias; não há pacote @apmcb/shared em uso por nenhum dos
// dois apps hoje).

export type ManutencaoStatus =
  | "avariado"
  | "manutencao"
  | "extraviado"
  | "furtado"
  | "em_pericia"
  | "bloqueado"
  | "em_transito"
  | "aguardando_baixa";

export type ManutencaoTab = "danificados" | "perdidos" | "administrativo";

export const TAB_STATUSES: Record<ManutencaoTab, ManutencaoStatus[]> = {
  danificados: ["avariado", "manutencao"],
  perdidos: ["extraviado", "furtado"],
  administrativo: ["em_pericia", "bloqueado", "em_transito", "aguardando_baixa"],
};

export const TAB_LABEL: Record<ManutencaoTab, string> = {
  danificados: "Danificados",
  perdidos: "Perdidos",
  administrativo: "Administrativo",
};

export const TAB_ORDER: ManutencaoTab[] = ["danificados", "perdidos", "administrativo"];

export const ALL_TRACKED_STATUSES: ManutencaoStatus[] = TAB_ORDER.flatMap((tab) => TAB_STATUSES[tab]);

export function statusToTab(status: string): ManutencaoTab | null {
  for (const tab of TAB_ORDER) {
    if ((TAB_STATUSES[tab] as string[]).includes(status)) return tab;
  }
  return null;
}

export const STATUS_LABEL: Record<ManutencaoStatus, string> = {
  avariado: "Avariado",
  manutencao: "Em manutenção",
  extraviado: "Extraviado",
  furtado: "Furtado",
  em_pericia: "Em perícia",
  bloqueado: "Bloqueado",
  em_transito: "Em trânsito",
  aguardando_baixa: "Aguardando baixa",
};

/** Classes de badge (globals.css) por status — reaproveita as já existentes
 * (badge-maintenance/badge-lost/badge-danger/badge-warning/badge-neutral). */
export const STATUS_BADGE_CLASS: Record<ManutencaoStatus, string> = {
  avariado: "badge-maintenance",
  manutencao: "badge-maintenance",
  extraviado: "badge-lost",
  furtado: "badge-danger",
  em_pericia: "badge-warning",
  bloqueado: "badge-warning",
  em_transito: "badge-neutral",
  aguardando_baixa: "badge-neutral",
};

/**
 * Grupos exibidos no modal "Registrar Ocorrência". Somente os status
 * "reportáveis" no relato inicial de campo — manutencao e aguardando_baixa
 * ficam de fora por serem decisões de triagem posteriores (não um relato
 * inicial), na mesma lógica que já bloqueia baixado/inapto/em_saida/cautelado.
 */
export const OCORRENCIA_GROUPS: {
  label: string;
  options: { value: ManutencaoStatus; label: string }[];
}[] = [
  {
    label: "Dano",
    options: [{ value: "avariado", label: STATUS_LABEL.avariado }],
  },
  {
    label: "Perda",
    options: [
      { value: "extraviado", label: STATUS_LABEL.extraviado },
      { value: "furtado", label: STATUS_LABEL.furtado },
    ],
  },
  {
    label: "Administrativo",
    options: [
      { value: "em_pericia", label: STATUS_LABEL.em_pericia },
      { value: "bloqueado", label: STATUS_LABEL.bloqueado },
      { value: "em_transito", label: STATUS_LABEL.em_transito },
    ],
  },
];

export const OCORRENCIA_TARGET_STATUSES: ManutencaoStatus[] = OCORRENCIA_GROUPS.flatMap((g) =>
  g.options.map((o) => o.value)
);
