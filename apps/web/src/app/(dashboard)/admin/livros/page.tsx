export const runtime = "edge";

import { Suspense } from "react";
import { AdminLivrosClient } from "./_admin-livros-client";

export default function AdminLivrosPage() {
  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-foreground">Livros Digitais de Serviço</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Histórico de todos os turnos — armeiros, reservas, eventos e pendências
        </p>
      </div>
      <Suspense fallback={<div className="h-40 flex items-center justify-center text-muted-foreground text-sm">Carregando...</div>}>
        <AdminLivrosClient />
      </Suspense>
    </div>
  );
}
