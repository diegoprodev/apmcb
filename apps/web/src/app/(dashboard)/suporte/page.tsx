export const runtime = "edge";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SupportContactCard } from "./_support-contact-card";

export default async function SuportePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const body = encodeURIComponent([
    "Descreva aqui o contexto:",
    "",
    "Tela/rota:",
    "Usuario:",
    user.email ?? "",
  ].join("\n"));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Suporte e feedback</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Envie problemas, elogios, críticas e sugestões para a Arckos IA.
        </p>
      </div>

      <SupportContactCard body={body} />
    </div>
  );
}
