export const runtime = "edge";

import type { Metadata } from "next";

interface Signer {
  nome_completo: string;
  matricula: string;
  posto: string;
}

interface Signature {
  id: string;
  document_type: string;
  document_hash: string;
  signature_proof: string;
  signed_at: string;
  totp_verified: boolean;
  signature_level: number;
  revoked_at: string | null;
  revocation_reason: string | null;
  signer: Signer | null;
}

interface VerifyResponse {
  found: boolean;
  document_id: string;
  status: "válido" | "revogado";
  active_signatures: Signature[];
  revoked_signatures: Signature[];
}

export const metadata: Metadata = {
  title: "Verificação de Documento — APMCB",
};

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

async function getVerification(document_id: string): Promise<VerifyResponse | null> {
  try {
    const res = await fetch(`${BFF_URL}/api/verify/${document_id}`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function VerifyPage({
  params,
}: {
  params: Promise<{ document_id: string }>;
}) {
  const { document_id } = await params;
  const data = await getVerification(document_id);

  return (
    <div className="min-h-screen bg-[#0d1117] text-white flex flex-col items-center py-10 px-4">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center font-bold text-sm">A</div>
          <span className="font-semibold text-sm text-gray-300">APMCB — Verificação de Documento</span>
        </div>

        {!data || !data.found ? (
          <div className="rounded-lg border border-gray-700 bg-gray-900 p-6">
            <div className="flex items-center gap-2 text-yellow-400 font-semibold mb-2">
              <span>⚠</span> Documento não encontrado
            </div>
            <p className="text-gray-400 text-sm">
              Nenhuma assinatura foi registrada para este ID de documento. Verifique se o link está correto.
            </p>
            <p className="text-gray-600 text-xs mt-3 font-mono break-all">{document_id}</p>
          </div>
        ) : (
          <>
            <div
              className={`rounded-lg border p-5 mb-6 ${
                data.status === "válido"
                  ? "border-green-700 bg-green-950"
                  : "border-red-700 bg-red-950"
              }`}
            >
              <div className="flex items-center gap-2 font-semibold text-lg mb-1">
                <span>{data.status === "válido" ? "✓" : "✗"}</span>
                <span className={data.status === "válido" ? "text-green-400" : "text-red-400"}>
                  Documento {data.status}
                </span>
              </div>
              <p className="text-gray-400 text-xs font-mono break-all">{data.document_id}</p>
            </div>

            {data.active_signatures.length > 0 && (
              <section className="mb-6">
                <h2 className="text-xs uppercase text-gray-500 font-semibold mb-3 tracking-wider">
                  Assinaturas Ativas
                </h2>
                <div className="flex flex-col gap-3">
                  {data.active_signatures.map((sig) => (
                    <SignatureCard key={sig.id} sig={sig} revoked={false} />
                  ))}
                </div>
              </section>
            )}

            {data.revoked_signatures.length > 0 && (
              <section>
                <h2 className="text-xs uppercase text-gray-500 font-semibold mb-3 tracking-wider">
                  Assinaturas Revogadas
                </h2>
                <div className="flex flex-col gap-3">
                  {data.revoked_signatures.map((sig) => (
                    <SignatureCard key={sig.id} sig={sig} revoked={true} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        <p className="text-center text-gray-600 text-xs mt-8">
          Sistema de Controle de Bens Sensíveis · PMPB/DEC/APMCB
        </p>
      </div>
    </div>
  );
}

function SignatureCard({ sig, revoked }: { sig: Signature; revoked: boolean }) {
  const date = new Date(sig.signed_at).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Recife",
  });

  return (
    <div
      className={`rounded-lg border p-4 ${
        revoked ? "border-gray-700 bg-gray-900 opacity-60" : "border-gray-700 bg-gray-900"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-sm">
            {sig.signer?.posto} {sig.signer?.nome_completo ?? "Desconhecido"}
          </p>
          <p className="text-gray-500 text-xs">{sig.signer?.matricula}</p>
        </div>
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            revoked
              ? "bg-red-900 text-red-300"
              : "bg-green-900 text-green-300"
          }`}
        >
          {revoked ? "Revogada" : "Válida"}
        </span>
      </div>
      <div className="mt-3 text-xs text-gray-500 space-y-0.5">
        <p>Data: {date}</p>
        <p>Nível: {sig.signature_level} · TOTP: {sig.totp_verified ? "verificado" : "não"}</p>
        {revoked && sig.revocation_reason && (
          <p className="text-red-400 mt-1">Motivo: {sig.revocation_reason}</p>
        )}
        <p className="font-mono break-all text-gray-700 mt-1">{sig.signature_proof}</p>
      </div>
    </div>
  );
}
