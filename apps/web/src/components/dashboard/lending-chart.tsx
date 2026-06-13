"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const mockData = [
  { day: "Seg", emprestimos: 3, devolucoes: 2 },
  { day: "Ter", emprestimos: 5, devolucoes: 3 },
  { day: "Qua", emprestimos: 4, devolucoes: 5 },
  { day: "Qui", emprestimos: 7, devolucoes: 4 },
  { day: "Sex", emprestimos: 6, devolucoes: 6 },
  { day: "Sab", emprestimos: 2, devolucoes: 3 },
  { day: "Dom", emprestimos: 1, devolucoes: 2 },
];

export function LendingChart() {
  return (
    <div className="rounded-2xl bg-card p-5 space-y-4" style={{ boxShadow: "var(--shadow-card)" }}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground tracking-tight">
            Atividade da Semana
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Empréstimos e devoluções — últimos 7 dias
          </p>
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: "#1B3A8C" }}
            />
            Empréstimos
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: "#10B981" }}
            />
            Devoluções
          </span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <AreaChart
          data={mockData}
          margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
        >
          <defs>
            <linearGradient id="gradEmprestimos" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#1B3A8C" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#1B3A8C" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradDevolucoes" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10B981" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="currentColor"
            strokeOpacity={0.08}
            vertical={false}
          />
          <XAxis
            dataKey="day"
            tick={{ fontSize: 11, fill: "currentColor", opacity: 0.5 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "currentColor", opacity: 0.5 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "10px",
              fontSize: "12px",
              boxShadow: "var(--shadow-modal)",
            }}
            labelStyle={{ fontWeight: 600, marginBottom: 4 }}
            itemStyle={{ color: "hsl(var(--foreground))" }}
          />
          <Area
            type="monotone"
            dataKey="emprestimos"
            name="Empréstimos"
            stroke="#1B3A8C"
            strokeWidth={2}
            fill="url(#gradEmprestimos)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
          <Area
            type="monotone"
            dataKey="devolucoes"
            name="Devoluções"
            stroke="#10B981"
            strokeWidth={2}
            fill="url(#gradDevolucoes)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
