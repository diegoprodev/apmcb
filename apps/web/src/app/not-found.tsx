export const runtime = "edge";

import Link from "next/link";
import Image from "next/image";
import { FileQuestionMark } from "lucide-react";

// Sem esta página, Next.js serve o fallback global default (texto em inglês,
// sem identidade visual, sem caminho de saída) para qualquer rota não
// encontrada — inclusive o caso de um PWA instalado há tempo servindo uma
// navegação para um chunk/rota que já não existe no deploy atual (ver sw.ts).
export default function NotFound() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-100">
        <div className="flex items-center gap-3 mb-8">
          <Image src="/images/logo.png" alt="APMCB" width={32} height={32} className="shrink-0" priority />
          <span className="text-sm font-semibold text-gray-800 tracking-wide">APMCB</span>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-gray-100 border border-gray-200 flex items-center justify-center">
              <FileQuestionMark className="size-6 text-gray-500" />
            </div>

            <div className="space-y-1">
              <p className="font-semibold text-gray-900">Página não encontrada</p>
              <p className="text-sm text-gray-500 leading-relaxed">
                O link que você acessou não existe mais ou o app pode estar com uma versão
                desatualizada em cache. Se isso persistir, feche e reabra o aplicativo.
              </p>
            </div>

            <Link
              href="/"
              className="flex items-center justify-center w-full h-11 rounded-xl text-sm font-semibold bg-[#1B3A8C] hover:bg-[#162f73] text-white transition-colors"
            >
              Ir para o início
            </Link>
          </div>
        </div>

        <p className="text-xs text-center text-gray-400 mt-6">
          APMCB Control System · by Arckos IA
        </p>
      </div>
    </div>
  );
}
