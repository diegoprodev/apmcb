import { redirect } from "next/navigation";
import { getSessionUser, getSessionProfile } from "@/lib/session-profile";
import { bffSessionHeaders } from "@/lib/web-session";
import { AdminSaidasClient } from "./_admin-saidas-client";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

export default async function AdminSaidasPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const profile = await getSessionProfile(user.id);

  if (profile?.role !== "admin_global" && profile?.role !== "superadmin") {
    redirect("/admin");
  }

  // R-28 / D-02: repassa a sessão do BFF (onde vive o Modo Usuário) em vez de
  // Bearer — o BFF não concede papel de staff a Bearer sem sessão.
  const res = await fetch(`${BFF_URL}/api/admin/estrutura`, {
    headers: await bffSessionHeaders(),
    cache: "no-store",
  });
  // Negação/falha deixa rastro (ex.: sessão do BFF ausente/expirada ou em
  // Modo Usuário) — senão a página só renderiza vazia.
  if (!res.ok) console.warn("[admin/saidas] BFF recusou /api/admin/estrutura", { status: res.status });

  const estrutura = res.ok
    ? (await res.json() as { org_units: { id: string; nome: string }[]; reserves: { id: string; nome: string; acronym: string; org_unit_id: string | null }[] })
    : { org_units: [], reserves: [] };

  return (
    <AdminSaidasClient
      orgUnits={estrutura.org_units}
      reserves={estrutura.reserves}
    />
  );
}
