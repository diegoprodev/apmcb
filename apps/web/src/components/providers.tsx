"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ThemeProvider } from "next-themes";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Toaster } from "@/components/ui/sonner";
import { createClient } from "@/lib/supabase/client";

// Redirect to /login whenever the Supabase session is invalidated (expired or
// revoked refresh token → 400 on /auth/v1/token → SIGNED_OUT event). Without
// this, the app silently retries with no valid token, causing console errors
// from Realtime WebSocket reconnection attempts.
function AuthListener() {
  const pathname = usePathname();

  useEffect(() => {
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (
        event === "SIGNED_OUT" &&
        !pathname.startsWith("/login") &&
        !pathname.startsWith("/auth") &&
        !pathname.startsWith("/nexus")
      ) {
        // Full page load — evita que o Router Cache reaproveite payload RSC
        // desta sessão para o próximo usuário que logar nesta aba.
        window.location.href = "/login";
      }
    });
    return () => subscription.unsubscribe();
  }, [pathname]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <AuthListener />
        {children}
        <Toaster richColors closeButton />
      </ThemeProvider>
      {process.env.NODE_ENV === "development" && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
