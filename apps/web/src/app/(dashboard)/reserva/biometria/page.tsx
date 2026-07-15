import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BiometricConsoleClient } from "./_biometric-console-client";

export default async function BiometriaReservaPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, default_tenant_id")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "armeiro" && profile?.role !== "admin_global" && profile?.role !== "admin_reserva") {
    redirect("/");
  }

  let reserves: { id: string; nome: string }[] = [];

  if (profile?.role === "admin_global" && profile.default_tenant_id) {
    const { data } = await supabase
      .from("reserves")
      .select("id, nome")
      .eq("tenant_id", profile.default_tenant_id)
      .order("nome", { ascending: true });
    reserves = data ?? [];
  } else {
    const { data: memberships } = await supabase
      .from("reserve_memberships")
      .select("reserve_id, reserves!inner(id, nome)")
      .eq("user_id", user.id);
    reserves = (memberships ?? [])
      .map((membership) => (membership as unknown as { reserves: { id: string; nome: string } }).reserves)
      .filter(Boolean);
  }

  return (
    <div data-testid="biometric-page">
      <BiometricConsoleClient
        reserveOptions={reserves}
        simulationUserId={user.id}
      />
    </div>
  );
}
