import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { MinhasCautelasClient, type Cautela } from "./_minhas-cautelas-client";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

export default async function MinhasCautelasPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: { session } } = await supabase.auth.getSession();

  let cautelas: Cautela[] = [];
  try {
    const res = await fetch(`${BFF_URL}/api/cautelamentos/ativos`, {
      headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      cache: "no-store",
    });
    if (res.ok) {
      const json = await res.json();
      cautelas = json.cautelamentos ?? [];
    }
  } catch {}

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-2xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-foreground">Minhas Cautelas</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Itens sob sua responsabilidade por cautela permanente
        </p>
      </div>
      <MinhasCautelasClient initialCautelas={cautelas} />
    </div>
  );
}
