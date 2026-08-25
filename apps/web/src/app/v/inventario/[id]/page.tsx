export const runtime = "edge";

import type { Metadata } from "next";
import { VerificationShell, type VerificationVariant } from "@/components/verify/verification-shell";

interface InventoryCampaign {
  id: string;
  nome: string;
  status: string;
  created_at: string;
}

interface InventoryVerifyResponse {
  valid: boolean;
  reason?: string;
  campaign?: InventoryCampaign;
}

export const metadata: Metadata = {
  title: "Verificação de Inventário — Andrômeda",
};

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

const STATUS_LABEL: Record<string, string> = {
  planejado: "Campanha planejada",
  em_andamento: "Campanha em andamento",
  em_revisao: "Campanha em revisão",
  concluido: "Campanha concluída",
  cancelado: "Campanha cancelada",
};

const STATUS_VARIANT: Record<string, VerificationVariant> = {
  concluido: "success",
  em_andamento: "success",
  em_revisao: "warning",
  planejado: "warning",
  cancelado: "danger",
};

// A rota BFF exige o hash como prova de posse do documento (não é uma
// simples consulta por id) — sem hash correto, devolve valid:false. A
// página recebe o hash via query string do próprio link/QR impresso no
// PDF, preservando essa semântica em vez de reescrevê-la.
async function getVerification(id: string, hash: string | undefined): Promise<InventoryVerifyResponse | null> {
  try {
    const url = new URL(`${BFF_URL}/api/inventory/verify/${id}`);
    if (hash) url.searchParams.set("hash", hash);
    const res = await fetch(url.toString(), { next: { revalidate: 30 } });
    // 400/404 aqui devolvem corpo JSON válido ({valid:false, reason}), não
    // vazio — por isso não checamos res.ok antes do parse, diferente de
    // turno/passagem (que descartam o corpo em erro). Resultado final é o
    // mesmo (found:false) nos dois estilos.
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

export default async function VerifyInventarioPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ hash?: string }>;
}) {
  const { id } = await params;
  const { hash } = await searchParams;
  const data = await getVerification(id, hash);
  const found = !!data?.valid && !!data.campaign;
  const campaign = data?.campaign;

  return (
    <VerificationShell
      title="Verificação de Inventário"
      documentId={id}
      found={found}
      variant={STATUS_VARIANT[campaign?.status ?? ""] ?? "warning"}
      statusLabel={STATUS_LABEL[campaign?.status ?? ""] ?? "Campanha de inventário"}
      notFoundMessage={
        data?.reason === "Hash inválido ou adulterado"
          ? "O hash deste link/QR não confere com o documento — pode ter sido adulterado ou copiado incorretamente."
          : "Hash inválido ou campanha não encontrada. Verifique se o link/QR está correto e completo."
      }
    >
      {campaign && (
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-5 space-y-3 text-sm">
          <div>
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Campanha</p>
            <p>{campaign.nome}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Registrada em</p>
            <p>{fmtDt(campaign.created_at)}</p>
          </div>
        </div>
      )}
    </VerificationShell>
  );
}
