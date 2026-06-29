"use client";

import { useEffect, useState } from "react";
import { Pencil, UserX, UserPlus, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditUserDialog, type UserData } from "./_edit-dialog";
import { DeactivateUserDialog } from "./_deactivate-dialog";
import { CreateUserDialog } from "./_create-user-dialog";
import { CadastrarMilitarDialog } from "./_cadastrar-militar-dialog";

export function UserRowActions({
  user,
  currentUserId,
  onUserUpdated,
}: {
  user: UserData & { activeCount: number };
  currentUserId: string;
  onUserUpdated?: (updated: Partial<UserData> & { id: string }) => void;
}) {
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
        onUserUpdated={onUserUpdated}
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

/**
 * Toolbar de criação de usuários — disponível para Admin e Master (Reserva de Armamento).
 *
 * [+ Cadastrar Militar]  — Registra o militar no sistema SEM credenciais de login.
 * [Criar Login]          — Provisiona acesso ao sistema (e-mail + magic link ou senha).
 *
 * callerRole "master": só pode criar role "usuario".
 * callerRole "admin": pode criar qualquer role.
 */
export function AdminUserToolbar({ callerRole = "admin_global" }: { callerRole?: "admin_global" | "admin_reserva" }) {
  const [cadastrarOpen, setCadastrarOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => setCadastrarOpen(true)}
          disabled={!mounted}
        >
          <UserPlus className="size-4" />
          Cadastrar Militar
        </Button>

        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => setLoginOpen(true)}
          disabled={!mounted}
        >
          <KeyRound className="size-4" />
          Criar Login
        </Button>
      </div>

      <CadastrarMilitarDialog
        open={cadastrarOpen}
        onClose={() => setCadastrarOpen(false)}
        callerRole={callerRole}
      />
      <CreateUserDialog
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        callerRole={callerRole}
      />
    </>
  );
}
