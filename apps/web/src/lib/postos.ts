/**
 * Postos/graduações — SSOT compartilhada entre todos os formulários que
 * cadastram ou editam militares (admin/usuarios, reserva/criar-armeiro,
 * perfil). Antes desta extração a mesma lista existia duplicada (com leves
 * divergências) em 4 arquivos — qualquer alteração de graduação exigia
 * lembrar de editar todos. Consolidado para reaproveitar exatamente uma
 * definição (regra canônica SRP/DRY/SSOT do projeto).
 *
 * A variante mantida é a que já estava presente em 3 dos 4 arquivos
 * (admin/usuarios/_edit-dialog.tsx, admin/usuarios/_create-user-dialog.tsx,
 * reserva/criar-armeiro/_criar-armeiro-client.tsx) — distingue Cad 1º/2º Ano
 * de "Cad" (cadete formado aguardando posto). O quarto arquivo (perfil/
 * _profile-client.tsx) usava uma lista mais antiga e menos granular; foi
 * atualizado para esta mesma lista.
 */
export const POSTOS = [
  { value: "sd",               label: "Sd" },
  { value: "cb",                label: "Cb" },
  { value: "3sgt",              label: "3° Sgt" },
  { value: "2sgt",              label: "2° Sgt" },
  { value: "1sgt",              label: "1° Sgt" },
  { value: "st",                label: "ST" },
  { value: "cad1ano",           label: "Cad 1° Ano" },
  { value: "cad2ano",           label: "Cad 2° Ano" },
  { value: "cadete",            label: "Cad" },
  { value: "aspirante",         label: "Asp" },
  { value: "segundo_tenente",   label: "2° Ten" },
  { value: "primeiro_tenente",  label: "1° Ten" },
  { value: "capitao",           label: "Cap" },
  { value: "major",             label: "Maj" },
  { value: "tenente_coronel",   label: "TC" },
  { value: "coronel",           label: "Cel" },
] as const;

export type PostoValue = (typeof POSTOS)[number]["value"];

/** Classes Tailwind padrão para os <select> customizados desses formulários. */
export const POSTO_SELECT_CLASS =
  "w-full h-10 appearance-none rounded-lg border border-input bg-card px-3 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer";
