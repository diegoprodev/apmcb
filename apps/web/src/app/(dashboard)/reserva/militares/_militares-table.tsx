"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  User, Fingerprint, CheckCircle2, AlertTriangle,
  Loader2, Package, ShieldCheck,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { FingerSelector } from "@/components/ui/finger-selector";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { UserRowActions } from "@/app/(dashboard)/admin/usuarios/_user-actions";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

export interface MilitarRow {
  id: string;
  nome_completo: string;
  matricula: string;
  posto: string | null;
  foto_url: string | null;
  email: string | null;
  nome_de_guerra: string | null;
  unidade: string | null;
  telefone: string | null;
  registration_status: "pending_biometric" | "complete" | "inactive";
  totp_configured: boolean;
  registeredFingers: number[];
  activeCount: number;
}

function getInitials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function MilitarSheet({
  militar,
  open,
  onClose,
}: {
  militar: MilitarRow;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [fingerIndex, setFingerIndex] = useState<number | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [registeredFingers, setRegisteredFingers] = useState<number[]>(militar.registeredFingers);

  const isPending = militar.registration_status === "pending_biometric";

  async function handleCapture() {
    if (fingerIndex === null) { toast.error("Selecione o dedo para captura"); return; }
    setCapturing(true);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;

      const res = await fetch(`${BFF_URL}/biometric/register`, {
        method: "POST",
        headers,
        body: JSON.stringify({ userId: militar.id, fingerIndex }),
      });

      const data = await res.json() as { ok?: boolean; quality?: number; error?: string };
      if (!res.ok) { toast.error(data.error ?? "Erro ao capturar biometria"); return; }

      toast.success(`Dedo ${fingerIndex} registrado${data.quality !== undefined ? ` (qualidade ${data.quality}%)` : ""}`);
      setRegisteredFingers((prev) => [...new Set([...prev, fingerIndex])]);
      setFingerIndex(null);
      router.refresh();
    } catch {
      toast.error("Erro de conexão com o leitor biométrico");
    } finally {
      setCapturing(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-2xl px-4 pb-8 pt-6 sm:px-8">
        <SheetHeader className="mb-5 text-left">
          <SheetTitle>Identificação Biométrica</SheetTitle>
        </SheetHeader>

        {/* Profile card */}
        <div className="flex items-center gap-4 mb-6">
          {militar.foto_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={militar.foto_url} alt={militar.nome_completo}
              className="w-16 h-16 rounded-2xl object-cover shrink-0 ring-2 ring-border" />
          ) : (
            <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center text-xl font-bold shrink-0">
              {getInitials(militar.nome_completo) || <User className="size-6" />}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-lg leading-tight">{militar.nome_completo}</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {militar.posto ? `${militar.posto} · ` : ""}
              <span className="font-mono text-xs">{militar.matricula}</span>
            </p>
            {militar.activeCount > 0 && (
              <div className="flex items-center gap-1.5 mt-1 text-xs text-amber-700">
                <Package className="size-3" />
                {militar.activeCount} material{militar.activeCount !== 1 ? "is" : ""} em uso
              </div>
            )}
          </div>
        </div>

        {/* Status banner — biometria */}
        {isPending || registeredFingers.length === 0 ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 mb-3">
            <AlertTriangle className="size-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800">Biometria pendente</p>
              <p className="text-xs text-amber-700 mt-0.5">
                Nenhum dedo cadastrado. Peça ao militar para apoiar o dedo no leitor.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 mb-3">
            <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
            <p className="text-sm font-medium text-emerald-800">
              {registeredFingers.length} dedo{registeredFingers.length !== 1 ? "s" : ""} cadastrado{registeredFingers.length !== 1 ? "s" : ""}
            </p>
          </div>
        )}

        {/* Status banner — TOTP */}
        {!militar.totp_configured ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 mb-5">
            <AlertTriangle className="size-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800">
                <abbr title="TOTP — Código de Verificação Temporal: número de 6 dígitos que muda a cada 30 segundos, necessário para retirar material" className="cursor-help underline decoration-dotted">TOTP</abbr>
                {" "}não configurado
              </p>
              <p className="text-xs text-amber-700 mt-0.5">
                Peça ao militar para acessar o app, ir em Perfil e configurar o Código de Acesso.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 mb-5">
            <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
            <p className="text-sm font-medium text-emerald-800">Código TOTP configurado</p>
          </div>
        )}

        {/* Finger selector */}
        <div className="space-y-3 mb-6">
          <p className="text-sm font-semibold">
            {registeredFingers.length === 0 ? "Selecionar dedo para cadastrar" : "Dedos cadastrados / Adicionar mais"}
          </p>
          <p className="text-xs text-muted-foreground">
            {registeredFingers.length > 0
              ? "Dedos em verde já estão cadastrados. Selecione outro para adicionar ou recapturar."
              : "Selecione o dedo e clique em Capturar Biometria."}
          </p>
          <div className="flex justify-center py-2 overflow-x-auto">
            <FingerSelector
              value={fingerIndex}
              onChange={setFingerIndex}
              disabled={capturing}
              registeredFingers={registeredFingers}
            />
          </div>
        </div>

        {/* Capture button */}
        <Button
          className="w-full h-12 text-base"
          onClick={handleCapture}
          disabled={capturing || fingerIndex === null}
        >
          {capturing ? (
            <><Loader2 className="size-4 animate-spin mr-2" />Aguardando leitura do dedo {fingerIndex}...</>
          ) : fingerIndex === null ? (
            <><Fingerprint className="size-5 mr-2" />Selecione um dedo acima</>
          ) : (
            <><Fingerprint className="size-5 mr-2" />
              {registeredFingers.includes(fingerIndex) ? `Recapturar dedo ${fingerIndex}` : `Capturar dedo ${fingerIndex}`}
            </>
          )}
        </Button>

        {registeredFingers.length > 0 && (
          <div className="flex items-center gap-2 mt-4 pt-4 border-t border-border/60">
            <ShieldCheck className="size-4 text-emerald-600 shrink-0" />
            <p className="text-xs text-muted-foreground">
              Dedos registrados:{" "}
              <span className="font-medium text-foreground">{registeredFingers.sort((a, b) => a - b).join(", ")}</span>
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function MilitaresTable({
  militares: initialMilitares,
  currentUserId,
}: {
  militares: MilitarRow[];
  currentUserId: string;
}) {
  const [militares, setMilitares] = useState<MilitarRow[]>(initialMilitares);
  const [selected, setSelected] = useState<MilitarRow | null>(null);
  const [photoLightbox, setPhotoLightbox] = useState<string | null>(null);

  function handleUserUpdated(updated: Partial<MilitarRow> & { id: string }) {
    setMilitares((prev) =>
      prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m))
    );
  }

  return (
    <>
      {photoLightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setPhotoLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoLightbox}
            alt="Foto do militar"
            className="max-w-[90vw] max-h-[90vh] rounded-2xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
      <div className="rounded-2xl bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-label">Nome</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-label">Matrícula</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-label">Posto</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-label">Biometria</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-label">Em uso</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-label">Ações</th>
              </tr>
            </thead>
            <tbody>
              {militares.map((m, i) => {
                const initials = getInitials(m.nome_completo);
                const isPending = m.registration_status === "pending_biometric";
                return (
                  <tr
                    key={m.id}
                    onClick={() => setSelected(m)}
                    className={`cursor-pointer hover:bg-primary/5 transition-colors ${
                      i < militares.length - 1 ? "border-b border-border/60" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {m.foto_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={m.foto_url} alt={m.nome_completo}
                            className="w-9 h-9 rounded-lg object-cover shrink-0 ring-1 ring-border cursor-zoom-in hover:ring-2 hover:ring-primary/50 transition-all"
                            onClick={(e) => { e.stopPropagation(); setPhotoLightbox(m.foto_url!); }} />
                        ) : (
                          <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                            {initials || <User className="size-4" />}
                          </div>
                        )}
                        <span className="font-medium text-foreground">{m.nome_completo}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{m.matricula}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{m.posto ?? "—"}</td>
                    <td className="px-4 py-3">
                      {isPending || m.registeredFingers.length === 0 ? (
                        <span className="badge-warning text-[10px] font-semibold tracking-wide rounded-full px-2.5 py-0.5">Bio Pendente</span>
                      ) : !m.totp_configured ? (
                        <abbr title="TOTP pendente — o militar ainda não configurou o código de verificação temporal (número de 6 dígitos que muda a cada 30 segundos, necessário para retirar material)" className="no-underline">
                          <span className="badge-warning text-[10px] font-semibold tracking-wide rounded-full px-2.5 py-0.5 cursor-help">TOTP Pendente</span>
                        </abbr>
                      ) : (
                        <span className="badge-success text-[10px] font-semibold tracking-wide rounded-full px-2.5 py-0.5">Completo</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {m.activeCount > 0 ? (
                        <span className="badge-in-use text-[10px] font-semibold tracking-wide rounded-full px-2.5 py-0.5">{m.activeCount}</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <UserRowActions
                        user={{ ...m, role: "usuario" }}
                        currentUserId={currentUserId}
                        onUserUpdated={handleUserUpdated}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <MilitarSheet
          key={selected.id}
          militar={selected}
          open={!!selected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
