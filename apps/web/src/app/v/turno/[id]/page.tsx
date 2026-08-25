export const runtime = "edge";

import type { Metadata } from "next";
import { VerificationShell, type VerificationVariant } from "@/components/verify/verification-shell";

interface ShiftVerifyResponse {
  verified: boolean;
  shift_id: string;
  status: "ativo" | "encerrado" | "encerrado_sem_passagem";
  started_at: string;
  ended_at: string | null;
  reserve: { nome: string; acronym: string } | null;
  armeiro: { nome_completo: string; posto: string | null } | null;
  event_count: number;
  root_hash: string | null;
  events: { happened_at: string; event_type: string; event_hash: string; prev_hash: string | null }[];
}

export const metadata: Metadata = {
  title: "Verificação de Turno — Andrômeda",
};

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

const STATUS_LABEL: Record<string, string> = {
  ativo: "Turno em andamento",
  encerrado: "Turno encerrado",
  encerrado_sem_passagem: "Turno encerrado (sem passagem)",
};

// Achado de code review: "success" fixo para qualquer status fazia um
// encerramento irregular (sem passagem de turno gerada) aparecer com o
// mesmo verde de sucesso de um encerramento normal — sem destaque visual
// da anomalia para quem audita o turno pelo QR.
const STATUS_VARIANT: Record<string, VerificationVariant> = {
  ativo: "warning",
  encerrado: "success",
  encerrado_sem_passagem: "warning",
};

async function getVerification(id: string): Promise<ShiftVerifyResponse | null> {
  try {
    const res = await fetch(`${BFF_URL}/api/public/shifts/${id}/verify`, {
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

export default async function VerifyTurnoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getVerification(id);
  const found = !!data?.verified;

  return (
    <VerificationShell
      title="Verificação de Turno"
      documentId={id}
      found={found}
      variant={STATUS_VARIANT[data?.status ?? ""] ?? "success"}
      statusLabel={STATUS_LABEL[data?.status ?? ""] ?? "Turno verificado"}
      notFoundMessage="Nenhum turno foi encontrado para este ID. Verifique se o link está correto."
    >
      {data && (
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-5 space-y-3 text-sm">
          <div>
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Reserva</p>
            <p>{data.reserve ? `${data.reserve.acronym} — ${data.reserve.nome}` : "—"}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Armeiro responsável</p>
            <p>{data.armeiro ? `${data.armeiro.posto ?? ""} ${data.armeiro.nome_completo}` : "—"}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Abertura</p>
              <p>{fmtDt(data.started_at)}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Encerramento</p>
              <p>{fmtDt(data.ended_at)}</p>
            </div>
          </div>
          <div>
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Eventos registrados</p>
            <p>{data.event_count}</p>
          </div>
          {data.root_hash && (
            <div>
              <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Hash raiz (cadeia de integridade)</p>
              <p className="font-mono break-all text-gray-600 text-xs">{data.root_hash}</p>
            </div>
          )}
        </div>
      )}
    </VerificationShell>
  );
}
