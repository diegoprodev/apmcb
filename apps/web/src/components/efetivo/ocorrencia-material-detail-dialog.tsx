"use client";

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ImageOff, Info } from "lucide-react";
import { APP_TIMEZONE } from "@/lib/format-date";

// Mesmo shape devolvido por loadOcorrenciasAssociadas (apps/bff/src/routes/
// usuario.ts) — consumido tanto pelo resumo em efetivo/historico quanto
// pela lista completa em efetivo/ocorrencias. Definido uma única vez aqui
// (SSOT) pros dois consumidores não divergirem.
export interface MaterialOcorrenciaSummary {
  id: string;
  identificador_principal: string;
  status_operacional: string;
  status_label: string;
  descricao_adicional: string | null;
  foto_display_url: string | null;
  registrada_em: string | null;
  material_type: { nome: string; categoria: string } | null;
  reserve: { nome: string } | null;
  registrado_por: { nome_completo: string; posto: string | null } | null;
}

// Formato "dd/mm/aaaa · hh:mm" (ponto médio, não vírgula) — mesmo estilo já
// estabelecido nesta área do produto (efetivo/historico), deliberadamente
// diferente de formatDateTime (@/lib/format-date, vírgula) — não trocado
// pela função compartilhada de propósito, pra não mudar o visual já
// consolidado desta tela. Exportada (SSOT) porque efetivo/ocorrencias
// (_ocorrencias-client.tsx) também precisa formatar data nesse mesmo estilo
// pra "Ocorrências que você reportou" — achado de code review: antes cada
// arquivo reimplementava a mesma função idêntica.
export function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const dt = new Date(iso);
  return (
    dt.toLocaleDateString("pt-BR", { timeZone: APP_TIMEZONE }) +
    " · " +
    dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: APP_TIMEZONE })
  );
}

/**
 * Card resumido de uma ocorrência de material — extraído pra componente
 * compartilhado (SSOT) porque agora tem 2 consumidores idênticos:
 * efetivo/historico (seção "associadas ao seu nome", só as mais recentes)
 * e efetivo/ocorrencias (lista completa dedicada). Antes de existir esta
 * segunda tela, a marcação vivia só dentro de _historico-client.tsx sem
 * onClick nenhum — achado real do usuário.
 */
export function OcorrenciaMaterialCard({
  ocorrencia,
  onClick,
}: {
  ocorrencia: MaterialOcorrenciaSummary;
  onClick: () => void;
}) {
  return (
    <div
      className="flex items-start gap-3 rounded-2xl bg-card p-3.5 cursor-pointer hover:bg-primary/5 transition-colors"
      style={{ boxShadow: "var(--shadow-card)" }}
      data-testid="historico-ocorrencia-item"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
    >
      <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/30 text-muted-foreground">
        {ocorrencia.foto_display_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ocorrencia.foto_display_url} alt="Foto da ocorrência" className="h-full w-full object-cover" />
        ) : (
          <ImageOff className="size-4" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium truncate">
            {ocorrencia.material_type?.nome ?? "Material"} — {ocorrencia.identificador_principal}
          </p>
          <Badge className="text-[10px] font-semibold px-2 py-0.5 bg-amber-500/10 text-amber-700 border-amber-500/30">
            {ocorrencia.status_label}
          </Badge>
        </div>
        {ocorrencia.descricao_adicional && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{ocorrencia.descricao_adicional}</p>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-1.5">
          {ocorrencia.reserve?.nome && <span>{ocorrencia.reserve.nome}</span>}
          {ocorrencia.registrado_por && (
            <span>
              Registrado por: {[ocorrencia.registrado_por.posto, ocorrencia.registrado_por.nome_completo.split(" ")[0]].filter(Boolean).join(" ")}
            </span>
          )}
          {ocorrencia.registrada_em && <span>{fmtDateTime(ocorrencia.registrada_em)}</span>}
        </div>
      </div>
    </div>
  );
}

/**
 * Detalhe somente-leitura de uma ocorrência de material (avaria/perda/
 * furtado/etc. — PATCH /api/arsenal/items/:id/ocorrencia) que ASSOCIA o
 * usuário logado ao registro. Achado real do usuário: o card resumido em
 * efetivo/historico não tinha onClick nenhum — clicar não fazia nada, e não
 * existia visão de detalhe/status em lugar nenhum. Somente leitura de
 * propósito: quem registra/resolve é o armeiro via console próprio
 * (_registrar-ocorrencia-dialog.tsx) — o militar associado só acompanha, daí
 * a nota fixa de contato abaixo em vez de qualquer ação.
 */
export function OcorrenciaMaterialDetailDialog({
  ocorrencia,
  onClose,
}: {
  ocorrencia: MaterialOcorrenciaSummary | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!ocorrencia} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {ocorrencia && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                {ocorrencia.material_type?.nome ?? "Material"}
                <Badge className="text-[10px] font-semibold px-2 py-0.5 bg-amber-500/10 text-amber-700 border-amber-500/30">
                  {ocorrencia.status_label}
                </Badge>
              </DialogTitle>
              <DialogDescription>
                Identificador #{ocorrencia.identificador_principal}
                {ocorrencia.material_type?.categoria ? ` · ${ocorrencia.material_type.categoria}` : ""}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 text-sm">
              <div className="flex size-24 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/30 text-muted-foreground mx-auto">
                {ocorrencia.foto_display_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ocorrencia.foto_display_url} alt="Foto da ocorrência" className="h-full w-full object-cover" />
                ) : (
                  <ImageOff className="size-6" />
                )}
              </div>

              {ocorrencia.descricao_adicional && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Descrição registrada</p>
                  <p className="whitespace-pre-line">{ocorrencia.descricao_adicional}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted/30 p-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Registrado por</p>
                  <p className="font-medium">
                    {ocorrencia.registrado_por
                      ? [ocorrencia.registrado_por.posto, ocorrencia.registrado_por.nome_completo].filter(Boolean).join(" ")
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Quando</p>
                  <p>{fmtDateTime(ocorrencia.registrada_em)}</p>
                </div>
                {ocorrencia.reserve?.nome && (
                  <div className="col-span-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Reserva</p>
                    <p>{ocorrencia.reserve.nome}</p>
                  </div>
                )}
              </div>

              {/* Achado real do usuário: este dialog é somente leitura de
                  propósito — quem resolve/atualiza a ocorrência é o armeiro,
                  não o militar associado. A nota abaixo é a única "ação"
                  disponível, redirecionando pro caminho certo. */}
              <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
                <Info className="size-3.5 shrink-0 mt-0.5" />
                <span>Para mais informações ou contestações, busque informações com o cadastrante desta ocorrência.</span>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" size="sm" onClick={onClose}>Fechar</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
