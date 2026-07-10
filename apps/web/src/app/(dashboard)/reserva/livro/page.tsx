
import { Suspense } from "react";
import { LivroClient } from "./_livro-client";

export default function LivroPage() {
  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-foreground">Livro Digital de Serviço</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Linha do tempo do seu turno — todos os eventos com hash verificável
        </p>
      </div>
      <Suspense fallback={<div className="h-40 flex items-center justify-center text-muted-foreground text-sm">Carregando...</div>}>
        <LivroClient />
      </Suspense>
    </div>
  );
}
