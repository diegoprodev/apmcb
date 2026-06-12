"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export type Role = "admin" | "master" | "military";

export function useRole() {
  const supabase = createClient();

  return useQuery({
    queryKey: ["auth", "role"],
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;

      const { data } = await supabase
        .from("profiles")
        .select("role, registration_status")
        .eq("id", user.id)
        .single();

      return data as { role: Role; registration_status: string } | null;
    },
    staleTime: 5 * 60 * 1000,
  });
}
