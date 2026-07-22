import { useEffect, useState } from "react";

function formatDurationMs(ms: number): string {
  if (ms < 0) ms = 0;
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `há ${minutes}min`;
  return `há ${hours}h ${minutes}min`;
}

// Duração "ao vivo" desde startedAt até agora (ou até endedAt, se o turno já
// encerrou — nesse caso não faz tick, é um valor fixo). Diferença calculada
// em epoch ms — não usa toLocale*/timezone, então não tem o risco de
// hydration mismatch já documentado neste projeto para exibição de datas.
export function useLiveDuration(startedAt: string, endedAt?: string | null): string {
  const startMs = new Date(startedAt).getTime();
  const endMs = endedAt ? new Date(endedAt).getTime() : null;
  const [now, setNow] = useState(() => endMs ?? Date.now());

  useEffect(() => {
    if (endMs !== null) return;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [endMs]);

  return formatDurationMs((endMs ?? now) - startMs);
}
