"use client";

import { useState, useEffect, useCallback } from "react";
import { Bell, Package, RotateCcw, UserCheck, Fingerprint, Bell as BellIcon } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

type NotificationType =
  | "material_issued"
  | "material_returned"
  | "account_created"
  | "biometric_registered";

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
  material_issued: <Package className="size-4 text-primary" />,
  material_returned: <RotateCcw className="size-4 text-emerald-600" />,
  account_created: <UserCheck className="size-4 text-sky-600" />,
  biometric_registered: <Fingerprint className="size-4 text-violet-600" />,
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

  const fetchCount = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (res.ok) {
        const d = await res.json();
        setCount(d.unread_count ?? 0);
      }
    } catch {
      // silent — user may not be logged in yet
    }
  }, []);

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
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
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
    // Mark each unread notification individually
    const unread = notifications.filter((n) => !n.read_at);
    await Promise.allSettled(
      unread.map((n) => fetch(`/api/notifications/${n.id}`, { method: "PATCH" }))
    );
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
        className="relative p-2 rounded-lg hover:bg-muted transition-colors"
      >
        <Bell className="size-5 text-muted-foreground" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white leading-none">
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
                    className={`flex gap-3 px-5 py-4 cursor-pointer hover:bg-muted/50 transition-colors ${
                      !n.read_at ? "bg-primary/5" : ""
                    }`}
                  >
                    <div className="mt-0.5 flex-shrink-0 w-7 h-7 rounded-full bg-muted flex items-center justify-center">
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
                          <span className="mt-1 flex-shrink-0 w-2 h-2 rounded-full bg-primary" />
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
