"use client";

import { signOutAndRedirect } from "@/lib/auth-actions";
import { LogOut } from "lucide-react";

export function SignOutButton() {
  async function handleSignOut() {
    await signOutAndRedirect();
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      className="flex items-center gap-2 w-full rounded-xl border border-destructive/30 bg-destructive/5 text-destructive px-4 py-3 text-sm font-medium hover:bg-destructive/10 transition-colors"
    >
      <LogOut className="size-4" />
      Sair da conta
    </button>
  );
}
