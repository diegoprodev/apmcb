"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Bell, Package, RotateCcw, UserCheck, Fingerprint, Bell as BellIcon, ClipboardList, ShieldCheck, ShieldX, Clock, Shield, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

type NotificationType =
  | "material_issued"
  | "material_returned"
  | "account_created"
  | "biometric_registered"
  | "totp_configured"
  | "armament_requested"
  | "armament_approved"
  | "armament_rejected"
  | "armament_delivered"
  | "armament_expired"
  | "ocorrencia_aberta"
  | "ocorrencia_resolvida";

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

const TYPE_ICON: Record<NotificationType, React.ReactNode> = {
  material_issued:      <Package       className="size-4 text-primary" />,
  material_returned:    <RotateCcw     className="size-4 text-emerald-600" />,
  account_created:      <UserCheck     className="size-4 text-sky-600" />,
  biometric_registered: <Fingerprint   className="size-4 text-violet-600" />,
  totp_configured:      <Shield        className="size-4 text-emerald-600" />,
  armament_requested:   <ClipboardList className="size-4 text-amber-600" />,
  armament_approved:    <ShieldCheck   className="size-4 text-emerald-600" />,
  armament_rejected:    <ShieldX       className="size-4 text-red-600" />,
  armament_delivered:   <Package       className="size-4 text-blue-600" />,
  armament_expired:     <Clock         className="size-4 text-gray-400" />,
  ocorrencia_aberta:    <AlertTriangle className="size-4 text-amber-600" />,
  ocorrencia_resolvida: <CheckCircle2  className="size-4 text-emerald-600" />,
};

// Badge color per notification type (unread dot)
const TYPE_DOT: Record<NotificationType, string> = {
  material_issued:      "bg-primary",
  material_returned:    "bg-emerald-500",
  account_created:      "bg-sky-500",
  biometric_registered: "bg-violet-500",
  totp_configured:      "bg-emerald-500",
  armament_requested:   "bg-amber-500",
  armament_approved:    "bg-emerald-500",
  armament_rejected:    "bg-red-500",
  armament_delivered:   "bg-blue-500",
  armament_expired:     "bg-gray-400",
  ocorrencia_aberta:    "bg-amber-500",
  ocorrencia_resolvida: "bg-emerald-500",
};

// Icon bg color per type
const TYPE_ICON_BG: Record<NotificationType, string> = {
  material_issued:      "bg-primary/10",
  material_returned:    "bg-emerald-100 dark:bg-emerald-950",
  account_created:      "bg-sky-100 dark:bg-sky-950",
  biometric_registered: "bg-violet-100 dark:bg-violet-950",
  totp_configured:      "bg-emerald-100 dark:bg-emerald-950",
  armament_requested:   "bg-amber-100 dark:bg-amber-950",
  armament_approved:    "bg-emerald-100 dark:bg-emerald-950",
  armament_rejected:    "bg-red-100 dark:bg-red-950",
  armament_delivered:   "bg-blue-100 dark:bg-blue-950",
  armament_expired:     "bg-gray-100 dark:bg-gray-800",
  ocorrencia_aberta:    "bg-amber-100 dark:bg-amber-950",
  ocorrencia_resolvida: "bg-emerald-100 dark:bg-emerald-950",
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}min atrás`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h atrás`;
  return `${Math.floor(hrs / 24)}d atrás`;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications");
      if (res.ok) {
        const d = await res.json();
        setNotifications(d.notifications ?? []);
        setCount(d.unread_count ?? 0);
      }
    } catch {
      // silent — user may not be logged in yet
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCount = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (res.ok) {
        const d = await res.json();
        setCount(d.unread_count ?? 0);
      }
    } catch {
      // silent
    }
  }, []);

  // Supabase Realtime subscription — updates count live without polling
  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;

      const channel = supabase
        .channel(`notifications:${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            const newNotification = payload.new as Notification;
            setCount((prev) => prev + 1);
            // If panel is open, prepend the notification immediately
            setNotifications((prev) => [newNotification, ...prev]);
          }
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            const updated = payload.new as Notification;
            setNotifications((prev) =>
              prev.map((n) => (n.id === updated.id ? { ...n, read_at: updated.read_at } : n))
            );
          }
        )
        .subscribe();

      channelRef.current = channel;
    });

    // Initial count fetch
    fetchCount();

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [fetchCount]);

  const handleOpen = (v: boolean) => {
    setOpen(v);
    if (v) fetchNotifications();
  };

  const markRead = async (id: string) => {
    await fetch(`/api/notifications/${id}`, { method: "PATCH" });
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === id ? { ...n, read_at: new Date().toISOString() } : n
      )
    );
    setCount((prev) => Math.max(0, prev - 1));
  };

  const markAllRead = async () => {
    await fetch("/api/notifications/read-all", { method: "POST" });
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() }))
    );
    setCount(0);
  };

  return (
    <>
      <button
        aria-label="Notificações"
        onClick={() => handleOpen(true)}
        className="relative p-2 rounded-lg hover:bg-primary/10 hover:text-primary transition-colors"
      >
        <Bell className="size-5 text-muted-foreground" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white leading-none ring-2 ring-background">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      <Sheet open={open} onOpenChange={handleOpen}>
        <SheetContent side="right" className="w-[380px] sm:w-[420px] p-0 flex flex-col">
          <SheetHeader className="px-5 pt-5 pb-3">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-base font-semibold">Notificações</SheetTitle>
              {count > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-7"
                  onClick={markAllRead}
                >
                  Marcar todas como lidas
                </Button>
              )}
            </div>
          </SheetHeader>
          <Separator />

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                Carregando...
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
                <BellIcon className="size-8 opacity-30" />
                <p className="text-sm">Nenhuma notificação</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {notifications.map((n) => (
                  <li
                    key={n.id}
                    onClick={() => !n.read_at && markRead(n.id)}
                    className={`flex gap-3 px-5 py-4 cursor-pointer hover:bg-primary/5 transition-colors ${
                      !n.read_at ? "bg-primary/5" : ""
                    }`}
                  >
                    <div className={`mt-0.5 shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${TYPE_ICON_BG[n.type]}`}>
                      {TYPE_ICON[n.type]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p
                          className={`text-sm leading-snug ${
                            !n.read_at ? "font-semibold" : "font-medium"
                          }`}
                        >
                          {n.title}
                        </p>
                        {!n.read_at && (
                          <span className={`mt-1.5 shrink-0 w-2 h-2 rounded-full ${TYPE_DOT[n.type]}`} />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {n.body}
                      </p>
                      <p className="text-xs text-muted-foreground/60 mt-1">
                        {timeAgo(n.created_at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
