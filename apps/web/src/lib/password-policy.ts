// Espelha a checagem client-side (passwordStrength score >= 2) usada em
// confirmar-conta e update-password — validação server-side para não confiar
// apenas no botão desabilitado da UI (contornável via fetch direto).
export function isPasswordStrongEnough(password: string): boolean {
  if (password.length < 8) return false;
  const hasSignal =
    password.length >= 12 ||
    /[A-Z]/.test(password) ||
    /[0-9]/.test(password) ||
    /[^A-Za-z0-9]/.test(password);
  return hasSignal;
}
