import { redirect } from "next/navigation";

// Setup 2FA acontece inline no fluxo de login do Nexus — não via URL direta.
// Acesso direto a esta rota redireciona para o login onde o setup ocorre.
export default function NexusSetup2FAPage() {
  redirect("/nexus/login");
}
