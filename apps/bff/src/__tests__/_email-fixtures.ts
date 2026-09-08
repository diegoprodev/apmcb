// Dados de exemplo válidos por template, para os loops que percorrem
// TEMPLATE_IDS. Cada fase que adiciona um template adiciona a amostra aqui.
export function sampleTemplateData(id: string, override = ""): Record<string, unknown> {
  const v = (base: string) => (override ? override : base);
  switch (id) {
    case "canary":
      return { nonce: v("abc123") };
    case "password_changed":
      return { quando: v("08/09/2026 19:40") };
    default:
      return {};
  }
}
