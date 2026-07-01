"use client";

import { NexusShell } from "./_components/nexus-shell";
import { HealthCard } from "./_components/health-card";
import { MetricsGrid } from "./_components/metrics-grid";
import { EventTable } from "./_components/event-table";
import { useNexusGuard } from "./_components/use-nexus-guard";
import { Loader2 } from "lucide-react";

export default function NexusDashboard() {
  const { ready } = useNexusGuard();

  if (!ready) {
    return (
      <div className="min-h-dvh bg-[#0A0A0F] flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-indigo-400" />
      </div>
    );
  }

  return (
    <NexusShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-lg font-bold text-white">Dashboard</h1>
          <p className="text-xs text-gray-500 mt-0.5">Monitoramento em tempo real do sistema</p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_240px] gap-6">
          {/* Left column */}
          <div className="space-y-6">
            <MetricsGrid />
            <EventTable />
          </div>

          {/* Right column */}
          <div>
            <HealthCard />
          </div>
        </div>
      </div>
    </NexusShell>
  );
}
