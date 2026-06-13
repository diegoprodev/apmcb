import { AlertCircle, AlertTriangle, Info, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

type Severity = "info" | "warning" | "danger" | "critical";

interface SeverityAlertProps {
  severity: Severity;
  title?: string;
  children: React.ReactNode;
  className?: string;
}

const config: Record<Severity, { icon: React.ElementType; iconClass: string }> = {
  info:     { icon: Info,         iconClass: "text-[var(--severity-info-icon)]" },
  warning:  { icon: AlertTriangle,iconClass: "text-[var(--severity-warning-icon)]" },
  danger:   { icon: AlertCircle,  iconClass: "text-[var(--severity-danger-icon)]" },
  critical: { icon: ShieldAlert,  iconClass: "text-[var(--severity-critical-icon)]" },
};

export function SeverityAlert({ severity, title, children, className }: SeverityAlertProps) {
  const { icon: Icon, iconClass } = config[severity];

  return (
    <div
      role="alert"
      className={cn(
        "flex gap-3 rounded-xl border px-4 py-3 text-sm",
        `severity-${severity}`,
        className
      )}
    >
      <Icon className={cn("size-4 shrink-0 mt-0.5", iconClass)} aria-hidden />
      <div className="space-y-0.5">
        {title && <p className="font-semibold leading-snug">{title}</p>}
        <div className="leading-relaxed">{children}</div>
      </div>
    </div>
  );
}
