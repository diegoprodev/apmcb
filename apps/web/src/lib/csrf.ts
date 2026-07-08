// CSRF token armazenado em sessionStorage (não document.cookie).
// Cookie csrf-token é httpOnly=true — inacessível ao JS.
// O token é entregue no body de /api/auth/exchange e /api/auth/login,
// armazenado aqui em memória de sessão, e enviado como header X-CSRF-Token.

export function getCsrfToken(): string {
  if (typeof sessionStorage === "undefined") return "";
  // sessionStorage é preferível (apagado ao fechar a aba).
  // Fallback para localStorage permite que storageState do Playwright capture
  // o token nos setups de teste sem precisar passar pelo fluxo de login completo.
  return sessionStorage.getItem("csrf-token") ?? localStorage.getItem("csrf-token") ?? "";
}

export function setCsrfToken(token: string): void {
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem("csrf-token", token);
  }
}

export function csrfHeaders(): HeadersInit {
  const token = getCsrfToken();
  return token ? { "X-CSRF-Token": token } : {};
}
