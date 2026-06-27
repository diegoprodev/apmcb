"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

interface ProfileClientProps {
  userId: string;
  name: string;
  role: string;
  matricula: string | null;
  posto: string | null;
  photoUrl: string | null;
}

export function ProfileClient({ userId, name, role, matricula, posto, photoUrl }: ProfileClientProps) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [density, setDensity] = useState(() =>
    typeof window === "undefined" ? "comfortable" : window.localStorage.getItem("apmcb-density") ?? "comfortable"
  );
  const [motion, setMotion] = useState(() =>
    typeof window === "undefined" ? "normal" : window.localStorage.getItem("apmcb-motion") ?? "normal"
  );
  const [file, setFile] = useState<File | null>(null);
  const [currentPhoto, setCurrentPhoto] = useState(photoUrl);
  const [saving, setSaving] = useState(false);

  function updateDensity(value: string) {
    setDensity(value);
    window.localStorage.setItem("apmcb-density", value);
    toast.success("Preferencia salva");
  }

  function updateMotion(value: string) {
    setMotion(value);
    window.localStorage.setItem("apmcb-motion", value);
    toast.success("Preferencia salva");
  }

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
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ foto_url: data.publicUrl })
        .eq("id", userId);
      if (updateError) throw updateError;

      setCurrentPhoto(data.publicUrl);
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
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Preferencias do sistema</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <PreferenceGroup
            label="Tema"
            value={theme ?? "system"}
            options={[
              { value: "system", label: "Sistema", icon: <Monitor className="size-4" /> },
              { value: "light", label: "Claro", icon: <Sun className="size-4" /> },
              { value: "dark", label: "Escuro", icon: <Moon className="size-4" /> },
            ]}
            onChange={setTheme}
          />
          <PreferenceGroup
            label="Densidade"
            value={density}
            options={[
              { value: "comfortable", label: "Confortavel" },
              { value: "compact", label: "Compacta" },
            ]}
            onChange={updateDensity}
          />
          <PreferenceGroup
            label="Movimento"
            value={motion}
            options={[
              { value: "normal", label: "Normal" },
              { value: "reduced", label: "Reduzido" },
            ]}
            onChange={updateMotion}
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
