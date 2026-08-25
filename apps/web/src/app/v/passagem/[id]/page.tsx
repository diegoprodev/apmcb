export const runtime = "edge";

import type { Metadata } from "next";
import { VerificationShell, type VerificationVariant } from "@/components/verify/verification-shell";

interface HandoverVerifyResponse {
  verified: boolean;
  id: string;
  document_hash: string;
  status: string;
  created_at: string;
  reserve: { nome: string; acronym: string } | null;
}

export const metadata: Metadata = {
  title: "Verificação de Passagem de Turno — Andrômeda",
};

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

const STATUS_LABEL: Record<string, string> = {
  aguardando_assinatura_saida: "Aguardando assinatura de saída",
  aguardando_atribuicao: "Aguardando atribuição",
  aguardando_assinatura_entrada: "Aguardando assinatura de entrada",
  concluido: "Passagem concluída",
  divergencia: "Passagem com divergência",
  vencido: "Passagem vencida",
  cancelado: "Passagem cancelada",
};

const STATUS_VARIANT: Record<string, VerificationVariant> = {
  concluido: "success",
  divergencia: "warning",
  vencido: "danger",
  cancelado: "danger",
};

async function getVerification(id: string): Promise<HandoverVerifyResponse | null> {
  try {
    const res = await fetch(`${BFF_URL}/api/handovers/${id}/verify`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function fmtDt(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("pt-BR", {
    timeZone: "America/Recife",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default async function VerifyPassagemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getVerification(id);
  const found = !!data?.verified;

  return (
    <VerificationShell
      title="Verificação de Passagem de Turno"
      documentId={id}
      found={found}
      variant={STATUS_VARIANT[data?.status ?? ""] ?? "warning"}
      statusLabel={STATUS_LABEL[data?.status ?? ""] ?? "Passagem de turno"}
      notFoundMessage="Nenhuma passagem de turno foi encontrada para este ID. Verifique se o link está correto."
    >
      {data && (
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-5 space-y-3 text-sm">
          <div>
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Reserva</p>
            <p>{data.reserve ? `${data.reserve.acronym} — ${data.reserve.nome}` : "—"}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Registrada em</p>
            <p>{fmtDt(data.created_at)}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Hash do documento</p>
            <p className="font-mono break-all text-gray-600 text-xs">{data.document_hash}</p>
          </div>
        </div>
      )}
    </VerificationShell>
  );
}
