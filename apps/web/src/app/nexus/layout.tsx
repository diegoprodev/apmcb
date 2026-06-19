import type { ReactNode } from "react";

// Nexus is fully isolated from the (dashboard) layout.
// Auth guard is done client-side per page via useNexusSession hook.
export default function NexusLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#0A0A0F] text-[#F8FAFC]">
      {children}
    </div>
  );
}
