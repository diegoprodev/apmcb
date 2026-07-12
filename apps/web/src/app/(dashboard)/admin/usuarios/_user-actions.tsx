"use client";

import { useEffect, useState } from "react";
import { Pencil, UserX, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditUserDialog, type UserData } from "./_edit-dialog";
import { DeactivateUserDialog } from "./_deactivate-dialog";
import { CadastrarUsuarioDialog } from "./_cadastrar-militar-dialog";

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
 * Ponto de entrada único [+ Cadastrar Usuário] abre um dialog com toggle
 * interno "Novo militar" / "Militar já cadastrado" — antes eram dois
 * botões/dialogs separados ("Cadastrar Usuário" sem login + "Criar Login"
 * buscando um militar existente), reportado como redundante e confuso
 * pelo dono do produto. Unificado em _cadastrar-militar-dialog.tsx.
 *
 * callerRole "armeiro": só pode criar/conceder acesso a role "usuario".
 * callerRole "admin_reserva": "usuario" e "armeiro" (gerencia a reserva).
 * callerRole "admin_global": sem restrição adicional aqui.
 */
export function AdminUserToolbar({ callerRole = "admin_global" }: { callerRole?: "admin_global" | "admin_reserva" | "armeiro" }) {
  const [cadastrarOpen, setCadastrarOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => setCadastrarOpen(true)}
          disabled={!mounted}
          data-testid="btn-cadastrar-usuario"
        >
          <UserPlus className="size-4" />
          Cadastrar Usuário
        </Button>
      </div>

      <CadastrarUsuarioDialog
        open={cadastrarOpen}
        onClose={() => setCadastrarOpen(false)}
        callerRole={callerRole}
      />
    </>
  );
}
