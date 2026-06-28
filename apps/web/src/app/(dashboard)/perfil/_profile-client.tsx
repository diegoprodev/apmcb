"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { csrfHeaders } from "@/lib/csrf";

interface ProfileClientProps {
  userId: string;
  name: string;
  role: string;
  matricula: string | null;
  posto: string | null;
  nomeDeGuerra: string | null;
  photoUrl: string | null;
}

const POSTOS = [
  { value: "", label: "Sem graduação" },
  { value: "sd", label: "Sd" },
  { value: "cb", label: "Cb" },
  { value: "3sgt", label: "3° Sgt" },
  { value: "2sgt", label: "2° Sgt" },
  { value: "1sgt", label: "1° Sgt" },
  { value: "st", label: "ST" },
  { value: "cadete", label: "Cadete" },
  { value: "aspirante", label: "Asp" },
  { value: "segundo_tenente", label: "2° Ten" },
  { value: "primeiro_tenente", label: "1° Ten" },
  { value: "capitao", label: "Cap" },
  { value: "major", label: "Maj" },
  { value: "tenente_coronel", label: "TC" },
  { value: "coronel", label: "Cel" },
];

export function ProfileClient({ userId, name, role, matricula, posto, nomeDeGuerra, photoUrl }: ProfileClientProps) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [file, setFile] = useState<File | null>(null);
  const [currentPhoto, setCurrentPhoto] = useState(photoUrl);
  const [saving, setSaving] = useState(false);
  const [editPosto, setEditPosto] = useState(posto ?? "");
  const [editNomeGuerra, setEditNomeGuerra] = useState(nomeDeGuerra ?? "");
  const [savingProfile, setSavingProfile] = useState(false);

  async function savePhoto() {
    if (!file) return;
    setSaving(true);
    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${userId}/profile.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("profile-photos")
        .upload(path, file, { cacheControl: "3600", upsert: true });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from("profile-photos").getPublicUrl(path);
      const photoUrl = `${data.publicUrl}?t=${Date.now()}`;

      const bffUrl = process.env.NEXT_PUBLIC_BFF_URL ?? "";
      const res = await fetch(`${bffUrl}/api/profiles/me`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        credentials: "include",
        body: JSON.stringify({ foto_url: data.publicUrl }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Erro ao salvar foto");
      }

      setCurrentPhoto(photoUrl);
      setFile(null);
      toast.success("Foto atualizada");
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao atualizar foto";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function saveProfile() {
    setSavingProfile(true);
    try {
      const bffUrl = process.env.NEXT_PUBLIC_BFF_URL ?? "";
      const res = await fetch(`${bffUrl}/api/profiles/me`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        credentials: "include",
        body: JSON.stringify({
          posto: editPosto || null,
          nome_de_guerra: editNomeGuerra || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Erro ao salvar");
      }
      toast.success("Dados atualizados");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSavingProfile(false);
    }
  }

  const initials = name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "AP";

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Avatar className="h-20 w-20">
            <AvatarImage src={currentPhoto ?? undefined} alt={name} />
            <AvatarFallback className="bg-primary text-primary-foreground text-lg">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold tracking-tight">{name}</h2>
            <p className="text-sm text-muted-foreground">{posto ?? "Sem posto"} · {matricula ?? "Sem matricula"}</p>
            <p className="mt-1 text-xs font-medium uppercase tracking-wide text-primary">{role}</p>
          </div>
          <div className="w-full sm:w-auto">
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="profile-photo">
              Foto do perfil
            </label>
            <input
              id="profile-photo"
              aria-label="Foto do perfil"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="user"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            />
            <Button className="mt-2 w-full gap-2" size="sm" onClick={savePhoto} disabled={!file || saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
              Atualizar foto
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }}>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">Editar dados pessoais</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="edit-posto">
              Posto/Graduação
            </label>
            <div className="relative">
              <select
                id="edit-posto"
                className="w-full h-10 appearance-none rounded-lg border border-input bg-card px-3 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 cursor-pointer"
                value={editPosto}
                onChange={(e) => setEditPosto(e.target.value)}
              >
                {POSTOS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 9l6 6 6-6"/></svg>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="edit-nome-guerra">
              Nome de Guerra
            </label>
            <input
              id="edit-nome-guerra"
              type="text"
              value={editNomeGuerra}
              onChange={(e) => setEditNomeGuerra(e.target.value)}
              placeholder="Como é chamado no dia a dia"
              className="w-full h-10 rounded-lg border border-input bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
            />
          </div>
        </div>
        <Button className="mt-4 gap-2" size="sm" onClick={saveProfile} disabled={savingProfile}>
          {savingProfile ? <Loader2 className="size-4 animate-spin" /> : null}
          Salvar dados
        </Button>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }}>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Preferencias do sistema</h3>
        <div className="mt-4 max-w-xs">
          <PreferenceGroup
            label="Tema"
            value={theme ?? "system"}
            options={[
              { value: "system", label: "Sistema", icon: <Sun className="size-4" /> },
              { value: "light", label: "Claro", icon: <Sun className="size-4" /> },
              { value: "dark", label: "Escuro", icon: <Moon className="size-4" /> },
            ]}
            onChange={setTheme}
          />
        </div>
      </section>
    </div>
  );
}

function PreferenceGroup({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; icon?: React.ReactNode }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex rounded-xl border border-border bg-muted/40 p-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium transition-colors ${
              value === option.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {option.icon}
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
