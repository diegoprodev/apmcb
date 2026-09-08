// Extrai o primeiro nome para saudação em e-mail transacional. Roda no BFF
// (os templates renderizam aqui, e `nome` vem do lookup em `profiles`, nunca
// do payload do caller — ver docs/email-transacional.md / plano §3.6).
//
// Se o valor recebido parecer um e-mail, é descartado: nunca queremos o
// endereço do destinatário estampado no corpo como se fosse o nome.
export function primeiroNome(
  nomeCompleto: string | null | undefined,
  fallback = "",
): string {
  const trimmed = (nomeCompleto ?? "").trim();
  if (!trimmed || trimmed.includes("@")) return fallback;
  return trimmed.split(/\s+/)[0];
}
