// Dados de exemplo válidos por template, para os loops que percorrem
// TEMPLATE_IDS. Cada fase que adiciona um template adiciona a amostra aqui.
export function sampleTemplateData(id: string, override = ""): Record<string, unknown> {
  const v = (base: string) => (override ? override : base);
  switch (id) {
    case "canary":
      return { nonce: v("abc123") };
    case "password_changed":
      return { quando: v("08/09/2026 19:40") };
    case "acesso":
      return { papel: v("Armeiro"), url: "https://apmcb.pmpb.online/auth/callback?next=/auth/update-password&token=abc" };
    case "welcome":
      return {};
    case "new_login":
      return { quando: v("10/09/2026 08:00"), dispositivo: "Chrome em Windows", ip_regiao: "191.0.0.x" };
    case "email_change_confirm":
      // `url` é z.string().url() — não aceita o override malicioso (mesma
      // razão de "acesso" acima não aplicar v() ao próprio url). A cobertura
      // de XSS deste template vem via recipient.nome/orgao no teste que
      // injeta { nome: XSS, orgao: XSS } separadamente.
      return { url: "https://apmcb.pmpb.online/auth/email-change/confirm?token=abc123" };
    case "email_changed_notice":
      // old_email/new_email são z.string().email() — mesma razão de não
      // aceitar override. `quando` é texto livre, então carrega o teste de
      // XSS nos dados (mesmo padrão de password_changed acima).
      return { old_email: "antigo@apmcb.dev", new_email: "novo@apmcb.dev", quando: v("15/09/2026 20:00") };
    case "email_change_requested_notice":
      // new_email é z.string().email(); quando é texto livre (mesmo padrão
      // de email_changed_notice acima).
      return { new_email: "novo@apmcb.dev", quando: v("15/09/2026 20:00") };
    default:
      return {};
  }
}
