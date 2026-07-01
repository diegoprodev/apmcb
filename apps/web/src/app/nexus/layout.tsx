import type { ReactNode } from "react";
import { NexusThemeProvider } from "./_components/nexus-theme-context";

// Nexus is fully isolated from the (dashboard) layout.
// Auth guard is done client-side per page via useNexusSession hook.
export default function NexusLayout({ children }: { children: ReactNode }) {
  return (
    <NexusThemeProvider>
      {children}
    </NexusThemeProvider>
  );
}
