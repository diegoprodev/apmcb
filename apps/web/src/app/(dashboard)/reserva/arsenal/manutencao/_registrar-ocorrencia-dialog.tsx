"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Camera, ChevronDown, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ComboBox } from "@/components/shared/combobox";
import { AsyncComboBox } from "@/components/shared/async-combobox";
import { bffFetch } from "@/lib/bff-client";
import { ApiError, friendlyApiError } from "@/lib/api-error";
import { POSTO_SELECT_CLASS } from "@/lib/postos";
import { OCORRENCIA_GROUPS, STATUS_LABEL, type ManutencaoStatus } from "@/lib/material-item-status";

type AvailableItem = {
  id: string;
  identificador_principal: string;
  material_type: { nome: string; categoria: string } | null;
  reserve: { nome: string; acronym: string } | null;
};

type ProfileOption = {
  id: string;
  nome_completo: string;
  matricula: string;
  posto: string | null;
};

// Supabase-js às vezes retorna a relação embutida como array — normaliza,
// mesmo padrão já usado em reserva/cautelas/_cautelas-client.tsx.
function firstOrSelf<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

// Mesmo endpoint/padrão já usado em reports/relatorio-filter-panel.tsx
// (searchProfiles + AsyncComboBox). Sem `role` na query, o endpoint pesquisa
// só role=usuario por padrão (ver GET /api/admin/search-profiles) — decisão
// deliberada aqui: quem plausivelmente estava com um item que apareceu
// avariado/extraviado numa conferência física é um usuário final (efetivo)
// com uma cautela/saída em aberto, não um armeiro/admin (que é justamente
// quem já está DENTRO deste modal registrando a ocorrência).
async function searchAssociableUsers(query: string): Promise<ProfileOption[]> {
  const res = await fetch(`/api/admin/search-profiles?q=${encodeURIComponent(query)}`, {
    credentials: "include",
  });
  if (!res.ok) return [];
  return res.json();
}

/**
 * Botão + modal para registrar que um item do estoque (nunca retirado) foi
 * encontrado com problema numa conferência física: dano, perda (extravio ou
 * furto) ou pendência administrativa (perícia/bloqueio/trânsito). Sem isso
 * não havia nenhum caminho para um item mudar de status fora do fluxo de
 * devolução de saída/cautela — ver PATCH /api/arsenal/items/:id/ocorrencia.
 *
 * Nota de design: o agrupamento em 3 categorias (Dano/Perda/Administrativo) e
 * a exigência do nº de B.O. para "Furtado" são decisão de implementação desta
 * entrega — documentado no relatório final para revisão do dono do produto.
 *
 * "Tipo de ocorrência" é um <select> nativo com <optgroup> (não mais um grid
 * de cards com ícone) — achado real (reclamação de produto, monitor de 14"):
 * o grid de 6 botões sozinho ocupava ~250-300px de altura, empurrando o
 * dialog inteiro além do viewport disponível (usuário precisava dar zoom-out
 * no navegador pra ver o rodapé). <select>+<optgroup> preserva o mesmo
 * agrupamento visual (Dano/Perda/Administrativo) em ~40px — Lei de Jakob (o
 * usuário já conhece um <select> de todo outro formulário deste app, mesmo
 * padrão de POSTO_SELECT_CLASS em _edit-dialog.tsx/role-select.tsx) e Lei de
 * Hick (menos alvos visuais simultâneos que 6 botões lado a lado).
 * DialogContent (componente base) agora limita altura e rola internamente —
 * ver components/ui/dialog.tsx — então mesmo com os campos novos abaixo
 * (foto e militar associado), o dialog nunca força zoom-out: rola.
 */
export function RegistrarOcorrenciaButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [items, setItems] = useState<AvailableItem[]>([]);
  const [selected, setSelected] = useState<AvailableItem | null>(null);
  const [novoStatus, setNovoStatus] = useState<ManutencaoStatus>("avariado");
  const [motivo, setMotivo] = useState("");
  const [numeroBo, setNumeroBo] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [associatedUser, setAssociatedUser] = useState<ProfileOption | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Achado de code review: URL.createObjectURL(photoFile) direto no JSX
  // rodava a cada re-render (qualquer tecla em "Motivo", troca de tipo etc.)
  // sem nunca chamar URL.revokeObjectURL — cada re-render vazava mais uma
  // blob URL apontando pros mesmos bytes da imagem (até 5MB), nunca liberada
  // pela sessão inteira (SPA, sem reload de página entre registros). Gerar a
  // URL uma vez por `photoFile` (não por render) e revogar no cleanup/troca.
  useEffect(() => {
    if (!photoFile) {
      setPhotoPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(photoFile);
    setPhotoPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  async function openDialog() {
    setOpen(true);
    setSelected(null);
    setNovoStatus("avariado");
    setMotivo("");
    setNumeroBo("");
    setPhotoFile(null);
    setAssociatedUser(null);
    setLoadingItems(true);
    try {
      // Via BFF, não client Supabase direto: a sessão sb-* vira HttpOnly
      // ~100ms após o login (ver auth/exchange/page.tsx), então o SDK do
      // browser nunca tem um JWT de usuário pra anexar nas próprias chamadas
      // a *.supabase.co depois do redirect — a query sempre rodava como anon
      // e a RLS corretamente devolvia vazio (bug silencioso, confirmado via
      // trace de rede: Authorization enviado era a própria anon key).
      const { ok, data } = await bffFetch("GET", "/api/arsenal/items/disponiveis");
      if (!ok) throw new Error("Falha ao buscar materiais disponíveis");
      setItems(
        (Array.isArray(data) ? data : []).map((i: AvailableItem) => ({
          ...i,
          material_type: firstOrSelf(i.material_type),
          reserve: firstOrSelf(i.reserve),
        }))
      );
    } catch (error) {
      console.error("[registrar-ocorrencia] falha ao buscar itens disponíveis", error);
      toast.error("Erro ao carregar materiais disponíveis. Tente novamente.");
    } finally {
      setLoadingItems(false);
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next && submitting) return;
    setOpen(next);
  }

  const motivoValido = motivo.trim().length >= 5;
  const isFurtado = novoStatus === "furtado";
  const numeroBoValido = !isFurtado || numeroBo.trim().length >= 3;
  const canSubmit = !!selected && motivoValido && numeroBoValido && !submitting;

  // Mesmo endpoint/padrão de admin/arsenal/_material-dialog.tsx — o bucket
  // material-photos é privado, então o upload passa por uma rota Next com
  // service role em vez do client Supabase do browser (que não tem sessão
  // legível pra autenticar contra o Storage; sb-* é HttpOnly). A resposta já
  // vem como path relativo (não URL pública), resolvido para exibição via
  // resolvePhotoUrl/signed URL em quem for exibir depois.
  async function uploadPhoto(): Promise<string | null> {
    if (!photoFile) return null;
    const form = new FormData();
    form.append("file", photoFile);
    const res = await fetch("/api/arsenal/material-photo", { method: "POST", body: form });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error || "Erro ao enviar foto");
    }
    const data = (await res.json()) as { photo_url: string };
    return data.photo_url;
  }

  async function handleSubmit() {
    if (!selected || !motivoValido || !numeroBoValido) return;
    setSubmitting(true);
    try {
      // Foto é opcional — só faz upload se o usuário escolheu um arquivo.
      // Uma falha aqui interrompe o submit ANTES do PATCH (evita registrar a
      // ocorrência sem a foto que o usuário pretendia anexar, deixando-o sem
      // saber que faltou); usuário pode tentar de novo ou remover a foto.
      let fotoUrl: string | null = null;
      if (photoFile) {
        try {
          fotoUrl = await uploadPhoto();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Erro ao enviar foto");
          setSubmitting(false);
          return;
        }
      }

      const { ok, status, data } = await bffFetch("PATCH", `/api/arsenal/items/${selected.id}/ocorrencia`, {
        novo_status: novoStatus,
        motivo: motivo.trim(),
        numero_bo: isFurtado ? numeroBo.trim() : undefined,
        foto_url: fotoUrl ?? undefined,
        usuario_associado_id: associatedUser?.id ?? undefined,
      });
      if (!ok) throw new ApiError(friendlyApiError(status, data.error, "Erro ao registrar ocorrência"), status);

      toast.success(`Ocorrência registrada — item ${STATUS_LABEL[novoStatus].toLowerCase()}`);
      setOpen(false);
      router.refresh();
    } catch (error) {
      console.error("[registrar-ocorrencia] falha ao registrar ocorrência", error);
      toast.error(error instanceof ApiError ? error.message : "Erro de conexão. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={openDialog}
        data-testid="manutencao-registrar-ocorrencia-btn"
      >
        <AlertTriangle className="size-4" />
        Registrar ocorrência
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg" data-testid="manutencao-ocorrencia-dialog">
          <DialogHeader>
            <DialogTitle>Registrar ocorrência de material</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Material</Label>
              <ComboBox<AvailableItem>
                items={items}
                selected={selected}
                onSelect={setSelected}
                placeholder={loadingItems ? "Carregando materiais..." : "Buscar por identificador ou nome..."}
                getLabel={(i) => `${i.material_type?.nome ?? "Material"} — ${i.identificador_principal}`}
                getSecondary={(i) => i.reserve?.nome ?? ""}
                disabled={loadingItems}
              />
              {!loadingItems && items.length === 0 && (
                <p className="text-xs text-muted-foreground">Nenhum material disponível encontrado.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ocorrencia-tipo-select">Tipo de ocorrência</Label>
              <div className="relative">
                <select
                  id="ocorrencia-tipo-select"
                  data-testid="ocorrencia-tipo-select"
                  value={novoStatus}
                  onChange={(e) => setNovoStatus(e.target.value as ManutencaoStatus)}
                  className={POSTO_SELECT_CLASS}
                >
                  {OCORRENCIA_GROUPS.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              </div>
            </div>

            {isFurtado && (
              <div className="space-y-1.5">
                <Label htmlFor="ocorrencia-numero-bo">Número do B.O.</Label>
                <Input
                  id="ocorrencia-numero-bo"
                  data-testid="ocorrencia-numero-bo-input"
                  value={numeroBo}
                  onChange={(e) => setNumeroBo(e.target.value)}
                  placeholder="Nº do Boletim de Ocorrência policial"
                />
                {!numeroBoValido && (
                  <p className="text-xs text-destructive">Obrigatório para itens furtados.</p>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="ocorrencia-motivo">Motivo / descrição</Label>
              <Textarea
                id="ocorrencia-motivo"
                data-testid="ocorrencia-motivo-input"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Descreva o que foi constatado (mínimo 5 caracteres)..."
                rows={3}
              />
            </div>

            {/* Foto e militar associado lado a lado (proximidade + compacidade
                vertical — os dois são opcionais e independentes um do outro). */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ocorrencia-foto">Foto (opcional)</Label>
                <div className="flex items-center gap-2.5 rounded-xl border border-border bg-muted/20 p-2.5">
                  <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-background text-muted-foreground">
                    {photoPreviewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photoPreviewUrl} alt="Prévia" className="h-full w-full object-cover" />
                    ) : (
                      <Camera className="size-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium hover:bg-muted">
                      <Upload className="size-3.5" />
                      {photoFile ? "Trocar" : "Selecionar"}
                      <Input
                        id="ocorrencia-foto"
                        aria-label="Foto da ocorrência"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        capture="environment"
                        disabled={submitting}
                        onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
                        className="sr-only"
                        data-testid="ocorrencia-foto-input"
                      />
                    </label>
                    {photoFile && (
                      <button
                        type="button"
                        onClick={() => setPhotoFile(null)}
                        className="ml-2 text-xs text-muted-foreground hover:text-foreground"
                      >
                        Remover
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Militar associado (opcional)</Label>
                <AsyncComboBox<ProfileOption>
                  selected={associatedUser}
                  onSelect={setAssociatedUser}
                  onSearch={searchAssociableUsers}
                  placeholder="Matrícula ou nome..."
                  getLabel={(p) => p.nome_completo}
                  getSecondary={(p) => [p.posto, p.matricula].filter(Boolean).join(" · ")}
                  disabled={submitting}
                  testId="ocorrencia-usuario-combo"
                />
                {associatedUser && (
                  <p className="text-[11px] text-muted-foreground">
                    Será notificado e verá esta ocorrência no próprio histórico.
                  </p>
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="mt-1">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit} data-testid="ocorrencia-submit-btn" className="gap-1.5">
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
