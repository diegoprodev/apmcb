"use client";

import { Moon, Sun, LogOut, Menu } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  userPhoto?: string | null;
}

export function Header({ userName, userPhoto }: HeaderProps) {
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

      <span className="font-semibold text-sm text-primary md:hidden">
        APMCB
      </span>

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
            <Avatar className="h-8 w-8">
              <AvatarImage src={userPhoto ?? undefined} alt={userName} />
              <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                {userName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
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
