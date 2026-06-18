"use client";

/**
 * Processa magic links com implicit flow (hash-based tokens).
 * Usado pelo harness de E2E: admin.generateLink → redirectTo aqui → setSession → redireciona por role.
 * NÃO exposto em produção para usuários reais (apenas para testes E2E via admin generateLink).
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ExchangePage() {
  const router = useRouter();

  useEffect(() => {
    async function process() {
      const hash = window.location.hash.slice(1);
      const params = new URLSearchParams(hash);
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");

      if (!access_token || !refresh_token) {
        router.replace("/auth/error");
        return;
      }

      const supabase = createClient();
      const { error } = await supabase.auth.setSession({ access_token, refresh_token });

      if (error) {
        router.replace("/auth/error");
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace("/auth/error"); return; }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      if (profile?.role === "admin") router.replace("/admin");
      else if (profile?.role === "master") router.replace("/reserva");
      else router.replace("/cadete");
    }

    process();
  }, [router]);

  return null;
}
