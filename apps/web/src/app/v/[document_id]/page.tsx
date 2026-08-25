export const runtime = "edge";

import type { Metadata } from "next";
import { VerificationShell } from "@/components/verify/verification-shell";

interface Signer {
  nome_completo: string;
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
  const found = !!data?.found;

  return (
    <VerificationShell
      title="Verificação de Documento"
      documentId={document_id}
      found={found}
      variant={data?.status === "válido" ? "success" : "danger"}
      statusLabel={`Documento ${data?.status ?? ""}`}
      notFoundMessage="Nenhuma assinatura foi registrada para este ID de documento. Verifique se o link está correto."
    >
      {data?.active_signatures && data.active_signatures.length > 0 && (
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

      {data?.revoked_signatures && data.revoked_signatures.length > 0 && (
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
    </VerificationShell>
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
