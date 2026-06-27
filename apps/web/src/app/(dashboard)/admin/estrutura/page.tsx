"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Building2, ChevronRight, Plus, Loader2, Upload, X, CheckCircle2, XCircle, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { csrfHeaders } from "@/lib/csrf";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

interface Tenant {
  id: string;
  nome: string;
  slug: string;
  structure_mode: "simple" | "structured";
}

interface OrgUnit {
  id: string;
  nome: string;
  acronym: string;
  type: string;
  status: string;
}

interface Reserve {
  id: string;
  nome: string;
  acronym: string;
  logo_url: string | null;
  status: string;
  org_unit_id: string | null;
}

interface StructureData {
  tenant: Tenant;
  org_units: OrgUnit[];
  reserves: Reserve[];
}

async function fetchStructure(): Promise<StructureData | null> {
  const res = await fetch(`${BFF_URL}/api/admin/estrutura`, { credentials: "include" });
  if (!res.ok) return null;
  const data = await res.json();
  return {
    tenant: data.tenant,
    org_units: data.org_units ?? [],
    reserves: data.reserves ?? [],
  };
}

export default function EstruturaPage() {
  const router = useRouter();
  const [structure, setStructure] = useState<StructureData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);

  const [orgDialog, setOrgDialog] = useState(false);
  const [reserveDialog, setReserveDialog] = useState(false);
  const [selectedOrgUnit, setSelectedOrgUnit] = useState<string | null>(null);
  const [orgForm, setOrgForm] = useState({ nome: "", acronym: "", type: "diretoria" });
  const [reserveForm, setReserveForm] = useState({ nome: "", acronym: "" });
  const [submitting, setSubmitting] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  // Branding
  const [branding, setBranding] = useState({ primary_hex: "#0f172a", secondary_hex: "#3b82f6", tenant_logo_url: null as string | null, reserve_logo_url: null as string | null });
  const [savingBranding, setSavingBranding] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState<string | null>(null);
  const tenantLogoRef = useRef<HTMLInputElement>(null);
  const reserveLogoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function init() {
      const meRes = await fetch(`${BFF_URL}/api/auth/me`, { credentials: "include" });
      if (!meRes.ok) { router.replace("/login"); return; }
      const me = await meRes.json();
      setTenantId(me.user?.tenantId ?? null);
      const [data, brandingRes] = await Promise.all([
        fetchStructure(),
        fetch(`${BFF_URL}/api/admin/branding`, { credentials: "include" }),
      ]);
      setStructure(data);
      if (brandingRes.ok) {
        const b = await brandingRes.json();
        setBranding({ primary_hex: b.primary_hex ?? "#0f172a", secondary_hex: b.secondary_hex ?? "#3b82f6", tenant_logo_url: b.tenant_logo_url ?? null, reserve_logo_url: b.reserve_logo_url ?? null });
      }
      setLoading(false);
    }
    init();
  }, [router]);

  async function refresh() {
    const data = await fetchStructure();
    setStructure(data);
  }

  async function handleCreateOrgUnit() {
    if (!tenantId || !orgForm.nome || !orgForm.acronym) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${BFF_URL}/api/nexus/tenants/${tenantId}/org-units`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify(orgForm),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Erro ao criar unidade"); return; }
      toast.success(`Unidade "${data.org_unit.nome}" criada`);
      setOrgDialog(false);
      setOrgForm({ nome: "", acronym: "", type: "diretoria" });
      refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateReserve() {
    if (!tenantId || !reserveForm.nome || !reserveForm.acronym) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${BFF_URL}/api/nexus/tenants/${tenantId}/reserves`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({
          ...reserveForm,
          org_unit_id: selectedOrgUnit ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Erro ao criar reserva"); return; }
      toast.success(`Reserva "${data.reserve.nome}" criada`);
      setReserveDialog(false);
      setReserveForm({ nome: "", acronym: "" });
      setSelectedOrgUnit(null);
      refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function saveBranding() {
    setSavingBranding(true);
    try {
      const res = await fetch(`${BFF_URL}/api/admin/branding`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ primary_hex: branding.primary_hex, secondary_hex: branding.secondary_hex }),
      });
      if (!res.ok) throw new Error();
      toast.success("Branding salvo");
    } catch {
      toast.error("Falha ao salvar branding");
    } finally {
      setSavingBranding(false);
    }
  }

  async function uploadBrandingLogo(file: File, logoType: "tenant" | "reserve") {
    setUploadingLogo(logoType);
    try {
      const fd = new FormData();
      fd.append("logo", file);
      fd.append("logo_type", logoType);
      const res = await fetch(`${BFF_URL}/api/admin/branding/logo`, {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders(),
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Falha no upload"); return; }
      setBranding((b) => ({ ...b, [`${logoType}_logo_url`]: data.url }));
      toast.success("Logo atualizado");
    } catch {
      toast.error("Erro ao enviar logo");
    } finally {
      setUploadingLogo(null);
    }
  }

  async function handleLogoUpload(reserveId: string, file: File) {
    setUploadingId(reserveId);
    try {
      const form = new FormData();
      form.append("logo", file);
      const res = await fetch(`${BFF_URL}/api/nexus/reserves/${reserveId}/logo`, {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders(),
        body: form,
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Erro ao fazer upload do logo"); return; }
      toast.success("Logo atualizado");
      refresh();
    } finally {
      setUploadingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!structure) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
        <Building2 className="size-10 text-muted-foreground" />
        <p className="text-muted-foreground text-sm">Tenant não encontrado ou sem permissão.</p>
      </div>
    );
  }

  const { tenant, org_units, reserves } = structure;
  const isStructured = tenant.structure_mode === "structured";

  const reservesWithoutOrg = reserves.filter((r) => !r.org_unit_id);

  return (
    <div className="flex-1 p-6 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Estrutura Organizacional</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {tenant.nome}{" "}
            <Badge variant="outline" className="text-xs ml-1">
              {isStructured ? "estruturado" : "simples"}
            </Badge>
          </p>
        </div>
        <div className="flex gap-2">
          {isStructured && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOrgDialog(true)}
            >
              <Plus className="size-3.5 mr-1" />
              Nova Unidade
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => {
              setSelectedOrgUnit(null);
              setReserveDialog(true);
            }}
          >
            <Plus className="size-3.5 mr-1" />
            Nova Reserva
          </Button>
        </div>
      </div>

      {/* ── Branding ── */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Palette className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Identidade Visual</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Cores */}
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Cores</p>
            {(["primary", "secondary"] as const).map((key) => {
              const field = `${key}_hex` as "primary_hex" | "secondary_hex";
              const label = key === "primary" ? "Cor primária" : "Cor secundária";
              return (
                <div key={key} className="space-y-1">
                  <Label className="text-xs">{label}</Label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={branding[field]} onChange={(e) => setBranding((b) => ({ ...b, [field]: e.target.value }))}
                      className="h-9 w-12 rounded-md cursor-pointer border border-border bg-transparent p-0.5" />
                    <Input value={branding[field]} onChange={(e) => setBranding((b) => ({ ...b, [field]: e.target.value }))}
                      className="flex-1 font-mono text-xs" maxLength={7} />
                  </div>
                </div>
              );
            })}
            <div className="h-8 rounded-lg mt-1" style={{ background: `linear-gradient(90deg, ${branding.primary_hex}, ${branding.secondary_hex})` }} />
            <Button size="sm" onClick={saveBranding} disabled={savingBranding} className="w-full">
              {savingBranding ? <Loader2 className="size-3.5 animate-spin" /> : "Salvar cores"}
            </Button>
          </div>
          {/* Logos */}
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Logos</p>
            {([
              { key: "tenant", label: "Logo do Órgão", ref: tenantLogoRef, url: branding.tenant_logo_url },
              { key: "reserve", label: "Logo da Reserva (sidebar)", ref: reserveLogoRef, url: branding.reserve_logo_url },
            ] as const).map(({ key, label, ref, url }) => (
              <div key={key} className="space-y-1">
                <Label className="text-xs">{label}</Label>
                <div className="flex items-center gap-3">
                  {url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={url} alt={label} className="h-9 w-9 rounded object-contain border border-border" />
                    : <div className="h-9 w-9 rounded border border-dashed border-border flex items-center justify-center"><Upload className="size-4 text-muted-foreground" /></div>
                  }
                  <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadBrandingLogo(f, key); }} />
                  <Button size="sm" variant="outline" onClick={() => ref.current?.click()} disabled={uploadingLogo === key} className="text-xs h-8">
                    {uploadingLogo === key ? <Loader2 className="size-3.5 animate-spin" /> : (url ? "Trocar" : "Enviar")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Structured: arvore org_unit → reserves */}
      {isStructured ? (
        <div className="space-y-4">
          {org_units.map((ou) => {
            const ouReserves = reserves.filter((r) => r.org_unit_id === ou.id);
            return (
              <div key={ou.id} className="rounded-xl border bg-card overflow-hidden">
                {/* Org Unit header */}
                <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-b">
                  <div className="flex items-center gap-2">
                    <Building2 className="size-4 text-primary" />
                    <span className="font-medium text-sm">{ou.nome}</span>
                    <span className="text-xs text-muted-foreground font-mono">({ou.acronym})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs ${ou.status === "ativa" ? "text-emerald-500" : "text-red-500"}`}>
                      {ou.status}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        setSelectedOrgUnit(ou.id);
                        setReserveDialog(true);
                      }}
                    >
                      <Plus className="size-3 mr-0.5" />
                      Reserva
                    </Button>
                  </div>
                </div>

                {/* Reserves dentro desta org_unit */}
                {ouReserves.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                    Nenhuma reserva criada nesta unidade.
                  </div>
                ) : (
                  <div className="divide-y">
                    {ouReserves.map((reserve) => (
                      <ReserveRow
                        key={reserve.id}
                        reserve={reserve}
                        uploading={uploadingId === reserve.id}
                        onUpload={(file) => handleLogoUpload(reserve.id, file)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Reserves sem org_unit (diretas no tenant) */}
          {reservesWithoutOrg.length > 0 && (
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="px-4 py-3 bg-muted/30 border-b">
                <span className="text-sm text-muted-foreground">Reservas sem unidade organizacional</span>
              </div>
              <div className="divide-y">
                {reservesWithoutOrg.map((reserve) => (
                  <ReserveRow
                    key={reserve.id}
                    reserve={reserve}
                    uploading={uploadingId === reserve.id}
                    onUpload={(file) => handleLogoUpload(reserve.id, file)}
                  />
                ))}
              </div>
            </div>
          )}

          {org_units.length === 0 && reserves.length === 0 && (
            <div className="rounded-xl border bg-card p-12 flex flex-col items-center gap-3 text-center">
              <Building2 className="size-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Nenhuma unidade ou reserva criada ainda.</p>
              <Button size="sm" onClick={() => setOrgDialog(true)}>
                <Plus className="size-3.5 mr-1" />
                Criar primeira unidade
              </Button>
            </div>
          )}
        </div>
      ) : (
        /* Simple: lista plana de reserves */
        <div className="rounded-xl border bg-card overflow-hidden">
          {reserves.length === 0 ? (
            <div className="p-12 flex flex-col items-center gap-3 text-center">
              <Building2 className="size-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Nenhuma reserva criada ainda.</p>
              <Button size="sm" onClick={() => setReserveDialog(true)}>
                <Plus className="size-3.5 mr-1" />
                Criar primeira reserva
              </Button>
            </div>
          ) : (
            <div className="divide-y">
              {reserves.map((reserve) => (
                <ReserveRow
                  key={reserve.id}
                  reserve={reserve}
                  uploading={uploadingId === reserve.id}
                  onUpload={(file) => handleLogoUpload(reserve.id, file)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Dialog: criar org_unit */}
      <Dialog open={orgDialog} onOpenChange={setOrgDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Nova Unidade Organizacional</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input
                value={orgForm.nome}
                onChange={(e) => setOrgForm((f) => ({ ...f, nome: e.target.value }))}
                placeholder="Ex: Diretoria de Educação e Cultura"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Sigla</Label>
                <Input
                  value={orgForm.acronym}
                  onChange={(e) => setOrgForm((f) => ({ ...f, acronym: e.target.value.toUpperCase() }))}
                  placeholder="DEC"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <select
                  value={orgForm.type}
                  onChange={(e) => setOrgForm((f) => ({ ...f, type: e.target.value }))}
                  className="w-full h-9 rounded-md border bg-background text-sm px-3"
                >
                  <option value="diretoria">Diretoria</option>
                  <option value="batalhao">Batalhão</option>
                  <option value="companhia">Companhia</option>
                  <option value="centro">Centro</option>
                  <option value="guarda">Guarda</option>
                  <option value="secretaria">Secretaria</option>
                  <option value="unidade">Unidade</option>
                  <option value="outro">Outro</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setOrgDialog(false)} disabled={submitting}>
                Cancelar
              </Button>
              <Button className="flex-1" onClick={handleCreateOrgUnit} disabled={submitting || !orgForm.nome || !orgForm.acronym}>
                {submitting ? <Loader2 className="size-4 animate-spin" /> : "Criar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog: criar reserva */}
      <Dialog open={reserveDialog} onOpenChange={setReserveDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Nova Reserva de Armamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            {selectedOrgUnit && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 rounded px-2 py-1.5">
                <ChevronRight className="size-3" />
                Vinculada a: {org_units.find((o) => o.id === selectedOrgUnit)?.nome ?? selectedOrgUnit}
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Nome da reserva</Label>
              <Input
                value={reserveForm.nome}
                onChange={(e) => setReserveForm((f) => ({ ...f, nome: e.target.value }))}
                placeholder="Ex: Academia de Polícia Militar do Cabo Branco"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Sigla</Label>
              <Input
                value={reserveForm.acronym}
                onChange={(e) => setReserveForm((f) => ({ ...f, acronym: e.target.value.toUpperCase() }))}
                placeholder="APMCB"
                className="font-mono"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setReserveDialog(false)} disabled={submitting}>
                Cancelar
              </Button>
              <Button className="flex-1" onClick={handleCreateReserve} disabled={submitting || !reserveForm.nome || !reserveForm.acronym}>
                {submitting ? <Loader2 className="size-4 animate-spin" /> : "Criar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReserveRow({
  reserve,
  uploading,
  onUpload,
}: {
  reserve: Reserve;
  uploading: boolean;
  onUpload: (file: File) => void;
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 hover:bg-muted/20 transition-colors">
      {/* Logo */}
      <div className="relative shrink-0 group">
        {reserve.logo_url ? (
          <img
            src={reserve.logo_url}
            alt={reserve.acronym}
            className="h-10 w-10 rounded-lg object-cover border"
          />
        ) : (
          <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center border text-xs font-mono text-muted-foreground">
            {reserve.acronym.slice(0, 3)}
          </div>
        )}
        <label className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
          {uploading ? (
            <Loader2 className="size-4 animate-spin text-white" />
          ) : (
            <Upload className="size-4 text-white" />
          )}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{reserve.nome}</p>
        <p className="text-xs text-muted-foreground font-mono">{reserve.acronym}</p>
      </div>

      {/* Status */}
      {reserve.status === "ativa" ? (
        <span className="flex items-center gap-1 text-emerald-500 text-xs shrink-0">
          <CheckCircle2 className="size-3.5" />
          Ativa
        </span>
      ) : (
        <span className="flex items-center gap-1 text-red-500 text-xs shrink-0">
          <XCircle className="size-3.5" />
          Inativa
        </span>
      )}
    </div>
  );
}
