import type { ReactNode } from "react";

// Extraído de apps/web/src/app/v/[document_id]/page.tsx (verificação de
// assinatura de documento) para ser reusado pelas páginas de verificação de
// Turno/Passagem/Inventário — mesmo visual (dark, card de status colorido),
// cada página só passa seus próprios dados já mapeados. Componente puro de
// apresentação: não faz fetch, não conhece o schema de nenhuma rota BFF.

export type VerificationVariant = "success" | "danger" | "warning";

const VARIANT_STYLES: Record<VerificationVariant, { border: string; bg: string; text: string; icon: string }> = {
  success: { border: "border-green-700", bg: "bg-green-950", text: "text-green-400", icon: "✓" },
  danger:  { border: "border-red-700",   bg: "bg-red-950",   text: "text-red-400",   icon: "✗" },
  warning: { border: "border-yellow-700", bg: "bg-yellow-950", text: "text-yellow-400", icon: "⚠" },
};

export function VerificationShell({
  title,
  documentId,
  found,
  variant,
  statusLabel,
  notFoundMessage,
  children,
}: {
  title: string;
  documentId: string;
  found: boolean;
  variant: VerificationVariant;
  statusLabel: string;
  notFoundMessage: string;
  children?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#0d1117] text-white flex flex-col items-center py-10 px-4">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center font-bold text-sm">A</div>
          <span className="font-semibold text-sm text-gray-300">Andrômeda — {title}</span>
        </div>

        {!found ? (
          <div className="rounded-lg border border-gray-700 bg-gray-900 p-6">
            <div className="flex items-center gap-2 text-yellow-400 font-semibold mb-2">
              <span>⚠</span> Documento não encontrado
            </div>
            <p className="text-gray-400 text-sm">{notFoundMessage}</p>
            <p className="text-gray-600 text-xs mt-3 font-mono break-all">{documentId}</p>
          </div>
        ) : (
          <>
            <div className={`rounded-lg border p-5 mb-6 ${VARIANT_STYLES[variant].border} ${VARIANT_STYLES[variant].bg}`}>
              <div className="flex items-center gap-2 font-semibold text-lg mb-1">
                <span>{VARIANT_STYLES[variant].icon}</span>
                <span className={VARIANT_STYLES[variant].text}>{statusLabel}</span>
              </div>
              <p className="text-gray-400 text-xs font-mono break-all">{documentId}</p>
            </div>

            {children}
          </>
        )}

        <p className="text-center text-gray-600 text-xs mt-8">
          Sistema de Controle de Bens Sensíveis · PMPB/DEC/APMCB
        </p>
      </div>
    </div>
  );
}
