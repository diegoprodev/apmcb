"use client";

import { LifeBuoy, LogOut, Menu, Moon, Sun, User } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUIStore } from "@/store/ui.store";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { NotificationBell } from "./notification-bell";

interface HeaderProps {
  userName: string;
  userGreeting?: string;
  userPhoto?: string | null;
}

export function Header({ userName, userGreeting, userPhoto }: HeaderProps) {
  const { theme, setTheme } = useTheme();
  const { toggleSidebar } = useUIStore();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <header
      className="h-14 border-b bg-card flex items-center px-4 gap-3"
      style={{ boxShadow: "0 1px 6px rgba(0,0,0,0.06)" }}
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleSidebar}
        className="md:hidden"
      >
        <Menu size={18} />
      </Button>

      <span className="flex items-center gap-1.5 font-semibold text-sm text-primary md:hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/logo.png" alt="Logo" className="h-6 w-auto" />
      </span>

      {userGreeting && (
        <span className="hidden md:block text-sm text-muted-foreground">
          Olá,{" "}
          <span className="font-semibold text-foreground">{userGreeting}</span>
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        <NotificationBell />

        <Button
          variant="ghost"
          size="icon"
          aria-label="Alternar tema"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger className="relative h-8 w-8 rounded-full outline-none">
            <Avatar className="h-8 w-8 overflow-hidden">
              {userPhoto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={userPhoto}
                  alt={userName}
                  loading="eager"
                  decoding="sync"
                  fetchPriority="high"
                  className="h-full w-full rounded-full object-cover"
                />
              ) : (
                <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                  {userName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              )}
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={() => router.push("/perfil")}>
              <User size={14} className="mr-2" />
              Perfil
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/suporte")}>
              <LifeBuoy size={14} className="mr-2" />
              Reportar
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleSignOut}
              className="text-destructive"
            >
              <LogOut size={14} className="mr-2" />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
