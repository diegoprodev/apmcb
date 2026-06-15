export function getCsrfToken(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(/(?:^|;\s*)csrf-token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

export function csrfHeaders(): HeadersInit {
  const token = getCsrfToken();
  return token ? { "X-CSRF-Token": token } : {};
}
