"use client";

import { useEffect, useState } from "react";
import { bffFetch } from "@/lib/bff-client";
import { Badge } from "@/components/ui/badge";
import { Loader2, MessageSquareWarning, Info } from "lucide-react";
import {
  OcorrenciaMaterialCard,
  OcorrenciaMaterialDetailDialog,
  fmtDateTime,
  type MaterialOcorrenciaSummary,
} from "@/components/efetivo/ocorrencia-material-detail-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// Shape devolvido por GET /api/ocorrencias quando role === "usuario" (ver
// apps/bff/src/routes/ocorrencias.ts) — ocorrência que o PRÓPRIO militar
// reportou (ReportarOcorrenciaSheet), distinta da ocorrência de MATERIAL
// registrada pelo armeiro (MaterialOcorrenciaSummary, associação por
// ocorrencia_usuario_associado_id). São dois sistemas independentes no
// banco — ver histórico desta investigação (2026-08-28).
interface OcorrenciaReportada {
  id: string;
  titulo: string;
  descricao: string;
  status: "aberta" | "em_analise" | "resolvida" | "improcedente";
  material_nome_snapshot: string | null;
  created_at: string;
  updated_at: string;
  resolvida_em: string | null;
  resolucao: string | null;
  resolvida_por_profile: { nome_completo: string } | null;
}

const STATUS_STYLE: Record<OcorrenciaReportada["status"], { label: string; cls: string }> = {
  aberta: { label: "Aberta", cls: "bg-amber-500/10 text-amber-700 border-amber-500/30" },
  em_analise: { label: "Em análise", cls: "bg-blue-500/10 text-blue-700 border-blue-500/30" },
  resolvida: { label: "Resolvida", cls: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30" },
  improcedente: { label: "Improcedente", cls: "bg-muted text-muted-foreground border-border" },
};

export function OcorrenciasClient() {
  const [reportadas, setReportadas] = useState<OcorrenciaReportada[]>([]);
  const [material, setMaterial] = useState<MaterialOcorrenciaSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedReportada, setSelectedReportada] = useState<OcorrenciaReportada | null>(null);
  const [selectedMaterial, setSelectedMaterial] = useState<MaterialOcorrenciaSummary | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [reportadasRes, materialRes] = await Promise.all([
          bffFetch("GET", "/api/ocorrencias"),
          bffFetch("GET", "/api/usuario/ocorrencias-material"),
        ]);
        if (cancelled) return;

        if (!reportadasRes.ok) {
          console.error("[efetivo/ocorrencias] falha ao carregar ocorrências reportadas", {
            status: reportadasRes.status, error: reportadasRes.data?.error,
          });
        } else {
          setReportadas((reportadasRes.data as unknown as OcorrenciaReportada[]) ?? []);
        }

        if (!materialRes.ok) {
          console.error("[efetivo/ocorrencias] falha ao carregar ocorrências de material", {
            status: materialRes.status, error: materialRes.data?.error,
          });
        } else {
          setMaterial((materialRes.data?.ocorrencias as MaterialOcorrenciaSummary[]) ?? []);
        }

        if (!reportadasRes.ok && !materialRes.ok) {
          setError("Não foi possível carregar suas ocorrências agora. Tente novamente em instantes.");
        }
      } catch (err) {
        if (cancelled) return;
        console.error("[efetivo/ocorrencias] falha de rede ao carregar ocorrências", err);
        setError("Erro de conexão. Tente novamente.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 gap-2 text-muted-foreground" data-testid="ocorrencias-loading">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Carregando ocorrências...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">
          Ocorrências que você reportou
        </h3>
        {reportadas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma ocorrência reportada até o momento.</p>
        ) : (
          <div className="space-y-2">
            {reportadas.map((oc) => {
              const st = STATUS_STYLE[oc.status];
              return (
                <div
                  key={oc.id}
                  className="flex items-start gap-3 rounded-2xl bg-card p-3.5 cursor-pointer hover:bg-primary/5 transition-colors"
                  style={{ boxShadow: "var(--shadow-card)" }}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedReportada(oc)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedReportada(oc); } }}
                >
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/30 text-muted-foreground">
                    <MessageSquareWarning className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium truncate">{oc.titulo}</p>
                      <Badge className={`text-[10px] font-semibold px-2 py-0.5 ${st.cls}`}>{st.label}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{oc.descricao}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-1.5">
                      {oc.material_nome_snapshot && <span>{oc.material_nome_snapshot}</span>}
                      <span>{fmtDateTime(oc.created_at)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">
          Ocorrências de material associadas ao seu nome
        </h3>
        {material.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma ocorrência de material associada ao seu nome.</p>
        ) : (
          <div className="space-y-2">
            {material.map((oc) => (
              <OcorrenciaMaterialCard key={oc.id} ocorrencia={oc} onClick={() => setSelectedMaterial(oc)} />
            ))}
          </div>
        )}
      </section>

      <OcorrenciaMaterialDetailDialog ocorrencia={selectedMaterial} onClose={() => setSelectedMaterial(null)} />

      <Dialog open={!!selectedReportada} onOpenChange={(next) => { if (!next) setSelectedReportada(null); }}>
        <DialogContent className="sm:max-w-md">
          {selectedReportada && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  {selectedReportada.titulo}
                  <Badge className={`text-[10px] font-semibold px-2 py-0.5 ${STATUS_STYLE[selectedReportada.status].cls}`}>
                    {STATUS_STYLE[selectedReportada.status].label}
                  </Badge>
                </DialogTitle>
                {selectedReportada.material_nome_snapshot && (
                  <DialogDescription>{selectedReportada.material_nome_snapshot}</DialogDescription>
                )}
              </DialogHeader>

              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Descrição</p>
                  <p className="whitespace-pre-line">{selectedReportada.descricao}</p>
                </div>

                <div className="rounded-xl bg-muted/30 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Reportada em</p>
                  <p>{fmtDateTime(selectedReportada.created_at)}</p>
                </div>

                {selectedReportada.status === "resolvida" || selectedReportada.status === "improcedente" ? (
                  <div className="rounded-xl bg-muted/30 p-3 space-y-1">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Resolução</p>
                    <p className="whitespace-pre-line">{selectedReportada.resolucao ?? "—"}</p>
                    {selectedReportada.resolvida_por_profile && (
                      <p className="text-xs text-muted-foreground">
                        Por {selectedReportada.resolvida_por_profile.nome_completo}
                        {selectedReportada.resolvida_em ? ` · ${fmtDateTime(selectedReportada.resolvida_em)}` : ""}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
                    <Info className="size-3.5 shrink-0 mt-0.5" />
                    <span>Sua ocorrência ainda está sendo analisada. Para mais informações, busque o responsável pela reserva.</span>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setSelectedReportada(null)}>Fechar</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
