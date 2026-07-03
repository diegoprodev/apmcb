import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminSaidasClient } from "./_admin-saidas-client";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

export default async function AdminSaidasPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin_global" && profile?.role !== "superadmin") {
    redirect("/admin");
  }

  const { data: { session } } = await supabase.auth.getSession();

  const res = await fetch(`${BFF_URL}/api/admin/estrutura`, {
    headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
    cache: "no-store",
  });

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
