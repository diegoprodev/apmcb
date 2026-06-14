"use client";

import { useState } from "react";
import { Pencil, UserX, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditUserDialog } from "./_edit-dialog";
import { DeactivateUserDialog } from "./_deactivate-dialog";
import { CreateUserDialog } from "./_create-user-dialog";

interface UserData {
  id: string;
  nome_completo: string;
  matricula: string;
  email: string | null;
  role: "admin" | "master" | "military";
  registration_status: "pending_biometric" | "complete" | "inactive";
  posto: string | null;
  unidade: string | null;
  telefone: string | null;
  activeCount: number;
}

export function UserRowActions({ user, currentUserId }: { user: UserData; currentUserId: string }) {
  const [editOpen, setEditOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-1 justify-end">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => setEditOpen(true)}
          title="Editar"
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={() => setDeactivateOpen(true)}
          title="Desativar"
          disabled={user.registration_status === "inactive"}
        >
          <UserX className="size-3.5" />
        </Button>
      </div>

      <EditUserDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        user={user}
        currentUserId={currentUserId}
      />
      <DeactivateUserDialog
        open={deactivateOpen}
        onClose={() => setDeactivateOpen(false)}
        user={{ ...user, activeCount: user.activeCount }}
        currentUserId={currentUserId}
      />
    </>
  );
}

export function CreateUserButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <UserPlus className="size-4" />
        Criar Usuário
      </Button>
      <CreateUserDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
