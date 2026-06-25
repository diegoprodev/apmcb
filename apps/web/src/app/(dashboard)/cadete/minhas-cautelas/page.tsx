export const runtime = "edge";

import { Suspense } from "react";
import { MinhasCautelasClient } from "./_minhas-cautelas-client";

export default function MinhasCautelasPage() {
  return (
    <div className="p-4 md:p-6 space-y-4 max-w-2xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-foreground">Minhas Cautelas</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Itens sob sua responsabilidade por cautela permanente
        </p>
      </div>
      <Suspense fallback={<div className="h-40 flex items-center justify-center text-muted-foreground text-sm">Carregando...</div>}>
        <MinhasCautelasClient />
      </Suspense>
    </div>
  );
}
