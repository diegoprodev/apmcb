"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import type { ChartDataPoint } from "./lending-chart";

// next/dynamic com ssr:false só é permitido dentro de um Client Component —
// admin/page.tsx (onde este wrapper é usado) é Server Component, então o
// code-splitting do recharts precisa ficar isolado aqui.
const LendingChart = dynamic(
  () => import("./lending-chart").then((m) => m.LendingChart),
  { ssr: false, loading: () => <Skeleton className="h-64 w-full rounded-xl" /> },
);

export function LendingChartLazy({ data }: { data: ChartDataPoint[] }) {
  return <LendingChart data={data} />;
}
