"use client";

import { Bell, Moon, Sun, LogOut, Menu } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useUIStore } from "@/store/ui.store";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

interface HeaderProps {
  userName: string;
  userPhoto?: string | null;
  unreadCount?: number;
}

export function Header({ userName, userPhoto, unreadCount = 0 }: HeaderProps) {
  const { theme, setTheme } = useTheme();
  const { toggleSidebar } = useUIStore();
  const router = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
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
        <Button variant="ghost" size="icon" className="relative">
          <Bell size={18} />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-4 w-4 p-0 flex items-center justify-center text-[10px]"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>

        <Button
          variant="ghost"
          size="icon"
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
