"use client";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Package, User, Shield, Clock, MapPin, Hash, Fingerprint, KeyRound,
  HandshakeIcon, Wifi, CheckCircle2, RotateCcw, FileText,
} from "lucide-react";

export interface SaidaRow {
  id: string;
  quantidade: number;
  status: "ativo" | "devolvido" | string;
  issued_at: string | null;
  returned_at: string | null;
  local: string | null;
  notes: string | null;
  auth_mode: "biometria" | "totp" | "manual" | null;
  material_request_id: string | null;
  material_type: { nome: string; categoria: string } | null;
  military: { nome_completo: string; matricula: string; posto: string | null } | null;
  master: { nome_completo: string; matricula: string } | null;
}

interface Props {
  saida: SaidaRow | null;
  open: boolean;
  onClose: () => void;
}

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(new Date(iso));
}

function authModeLabel(mode: SaidaRow["auth_mode"]) {
  switch (mode) {
    case "biometria": return { label: "Biometria Digital", icon: <Fingerprint className="size-3.5 text-emerald-600" /> };
    case "totp": return { label: "Código TOTP", icon: <KeyRound className="size-3.5 text-blue-600" /> };
    case "manual": return { label: "Manual", icon: <HandshakeIcon className="size-3.5 text-muted-foreground" /> };
    default: return { label: "—", icon: null };
  }
}

function DetailRow({
  icon,
  label,
  value,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border/50 last:border-0">
      <div className="mt-0.5 shrink-0 text-muted-foreground">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">{label}</p>
        <div className={`text-sm font-medium text-foreground ${mono ? "font-mono" : ""}`}>{value}</div>
      </div>
    </div>
  );
}

export function LendingDetailSheet({ saida, open, onClose }: Props) {
  if (!saida) return null;

  const authMode = authModeLabel(saida.auth_mode);
  const isRemote = !!saida.material_request_id;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-2xl px-4 pb-8 pt-6 sm:px-8">
        <SheetHeader className="mb-5 text-left">
          <SheetTitle className="flex items-center gap-2">
            <Package className="size-5 text-primary" />
            Detalhe da Saída
          </SheetTitle>
        </SheetHeader>

        {/* Status badge + tipo */}
        <div className="flex items-center gap-2 mb-5">
          <span
            className={`text-xs font-semibold rounded-full px-3 py-1 ${
              saida.status === "ativo"
                ? "badge-in-use"
                : "badge-success"
            }`}
          >
            {saida.status === "ativo" ? "Ativo" : "Devolvido"}
          </span>
          <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground bg-muted rounded-full px-3 py-1">
            {isRemote ? (
              <><Wifi className="size-3" />Remota (SSA)</>
            ) : (
              <><HandshakeIcon className="size-3" />Presencial</>
            )}
          </span>
        </div>

        {/* Sections */}
        <div className="space-y-1">

          {/* Material */}
          <div className="rounded-xl border border-border bg-muted/10 px-3 mb-3">
            <DetailRow
              icon={<Package className="size-4" />}
              label="Material"
              value={
                <span>
                  {saida.material_type?.nome ?? "—"}
                  {saida.material_type?.categoria && (
                    <span className="ml-2 text-xs text-muted-foreground font-normal capitalize">
                      {saida.material_type.categoria}
                    </span>
                  )}
                </span>
              }
            />
            <DetailRow
              icon={<Hash className="size-4" />}
              label="Quantidade"
              value={saida.quantidade}
            />
          </div>

          {/* Identidade */}
          <div className="rounded-xl border border-border bg-muted/10 px-3 mb-3">
            <DetailRow
              icon={<User className="size-4" />}
              label="Militar"
              value={
                <span>
                  {saida.military?.posto ? `${saida.military.posto} ` : ""}
                  {saida.military?.nome_completo ?? "—"}
                  <span className="ml-2 text-xs text-muted-foreground font-mono font-normal">
                    {saida.military?.matricula}
                  </span>
                </span>
              }
            />
            <DetailRow
              icon={<Shield className="size-4" />}
              label="Armeiro responsável"
              value={
                <span>
                  {saida.master?.nome_completo ?? "—"}
                  {saida.master?.matricula && (
                    <span className="ml-2 text-xs text-muted-foreground font-mono font-normal">
                      {saida.master.matricula}
                    </span>
                  )}
                </span>
              }
            />
          </div>

          {/* Detalhes do armamento */}
          <div className="rounded-xl border border-border bg-muted/10 px-3 mb-3">
            <DetailRow
              icon={<Clock className="size-4" />}
              label="Data/Hora da saída"
              value={formatDateTime(saida.issued_at)}
              mono
            />
            {saida.local && (
              <DetailRow
                icon={<MapPin className="size-4" />}
                label="Local"
                value={saida.local}
              />
            )}
            <DetailRow
              icon={authMode.icon ?? <Shield className="size-4" />}
              label="Modo de autenticação"
              value={
                <span className="flex items-center gap-1.5">
                  {authMode.icon}
                  {authMode.label}
                </span>
              }
            />
          </div>

          {/* Devolução */}
          {saida.status === "devolvido" && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 mb-3">
              <DetailRow
                icon={<RotateCcw className="size-4 text-emerald-600" />}
                label="Devolvido em"
                value={
                  <span className="text-emerald-700">{formatDateTime(saida.returned_at)}</span>
                }
                mono
              />
              <DetailRow
                icon={<CheckCircle2 className="size-4 text-emerald-600" />}
                label="Situação"
                value={<span className="badge-success text-xs px-2 py-0.5 rounded-full">Devolvido</span>}
              />
            </div>
          )}

          {/* Observações */}
          {saida.notes && (
            <div className="rounded-xl border border-border bg-muted/10 px-3 mb-3">
              <DetailRow
                icon={<FileText className="size-4" />}
                label="Observações"
                value={<span className="text-sm text-muted-foreground font-normal">{saida.notes}</span>}
              />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
