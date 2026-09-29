export const runtime = "edge";

import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session-profile";
import { LivroClient } from "./_livro-client";

export default async function LivroPage() {
  // Usuário resolvido no servidor (mesmo padrão de minhas-cautelas): o turno
  // por digital é 1:1 com o próprio armeiro e não pode depender de um
  // /api/auth/me no cliente — que deixava a captura sem usuário esperado
  // enquanto carregava e falhava em silêncio.
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-foreground">Livro Digital de Serviço</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Linha do tempo do seu turno — todos os eventos com hash verificável
        </p>
      </div>
      <Suspense fallback={<div className="h-40 flex items-center justify-center text-muted-foreground text-sm">Carregando...</div>}>
        <LivroClient currentUserId={user.id} />
      </Suspense>
    </div>
  );
}
