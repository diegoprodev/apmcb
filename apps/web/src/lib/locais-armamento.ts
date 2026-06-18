export const LOCAIS_ARMAMENTO = [
  "Almoxarifado",
  "Academia",
  "Campo",
  "Depósito",
  "Outro",
] as const;

export type LocalArmamento = (typeof LOCAIS_ARMAMENTO)[number];
