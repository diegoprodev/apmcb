"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";

type Severity = "critical" | "warning" | "info" | "ok";

interface CommandCardProps {
  title:        string;
  count:        number;
  severity:     Severity;
  icon:         LucideIcon;
  href?:        string;
  loading?:     boolean;
  description?: string;
}

// Apenas tokens do design system + amber/blue para distinção semântica (documentado em phase-7)
const severityStyles: Record<Severity, {
  border: string; badge: string; iconBg: string; text: string;
}> = {
  critical: {
    border:  "border-l-destructive",
    badge:   "bg-destructive/10",
    iconBg:  "bg-destructive/10",
    text:    "text-destructive",
  },
  warning: {
    border:  "border-l-amber-500",
    badge:   "bg-amber-500/10",
    iconBg:  "bg-amber-500/10",
    text:    "text-amber-500",
  },
  info: {
    border:  "border-l-primary",
    badge:   "bg-primary/10",
    iconBg:  "bg-primary/10",
    text:    "text-primary",
  },
  ok: {
    border:  "border-l-muted",
    badge:   "bg-muted/40",
    iconBg:  "bg-muted/40",
    text:    "text-muted-foreground",
  },
};

export function CommandCard({
  title, count, severity, icon: Icon, href, loading, description,
}: CommandCardProps) {
  const s    = severityStyles[severity];
  const zero = count === 0;

  const inner = (
    <div
      data-testid={`command-card-${title.toLowerCase().replace(/\s+/g, "-")}`}
      className={[
        "rounded-2xl bg-card border-l-4 p-4 space-y-3",
        "transition-all duration-150",
        href && count > 0 ? "hover:-translate-y-0.5 cursor-pointer" : "",
        zero ? "border-l-muted" : s.border,
      ].join(" ")}
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className={[
          "size-9 rounded-xl flex items-center justify-center shrink-0",
          zero ? "bg-muted/40" : s.iconBg,
        ].join(" ")}>
          {loading ? (
            <div className="size-4 border-2 border-current border-t-transparent rounded-full animate-spin opacity-60" />
          ) : (
            <Icon className={["size-4", zero ? "text-muted-foreground" : s.text].join(" ")} />
          )}
        </div>
        <span className={[
          "text-2xl font-bold tabular-nums",
          loading ? "opacity-30 animate-pulse" : "",
          zero ? "text-muted-foreground" : "text-foreground",
        ].join(" ")}>
          {loading ? "—" : count}
        </span>
      </div>

      <div>
        <p className="text-xs font-medium text-foreground leading-snug">{title}</p>
        {description && (
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{description}</p>
        )}
      </div>

      {href && count > 0 && (
        <p className={["text-[11px] font-medium", s.text].join(" ")}>Ver detalhes →</p>
      )}
    </div>
  );

  if (href && count > 0) {
    return <Link href={href}>{inner}</Link>;
  }
  return inner;
}
