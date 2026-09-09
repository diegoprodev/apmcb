"use client";

import { useEffect, useState } from "react";
import { Pencil, UserX, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditUserDialog, type UserData } from "./_edit-dialog";
import { DeactivateUserDialog } from "./_deactivate-dialog";
import { CadastrarUsuarioDialog } from "./_cadastrar-militar-dialog";
import { SendAccessAction } from "./_send-access-action";

export function UserRowActions({
  user,
  currentUserId,
  callerRole = "admin_global",
  onUserUpdated,
}: {
  // Campos de acesso obrigatórios — UserRow (/admin/usuarios) e MilitarRow
  // (/reserva/militares) já os carregam. Exigi-los aqui (em vez de opcional
  // + `?? null`) faz o TS pegar um call site que esquecer de passá-los, em
  // vez de silenciosamente tratar um usuário ativo como "Sem acesso".
  user: UserData & {
    activeCount: number;
    totp_configured: boolean;
    invite_sent_at: string | null;
    account_activated_at: string | null;
  };
  currentUserId: string;
  callerRole?: "admin_global" | "admin_reserva" | "armeiro";
  onUserUpdated?: (updated: Partial<UserData> & { id: string; invite_sent_at?: string | null }) => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-1 justify-end">
        <SendAccessAction
          user={{
            id: user.id,
            nome_completo: user.nome_completo,
            email: user.email,
            role: user.role,
            registration_status: user.registration_status,
            totp_configured: user.totp_configured,
            invite_sent_at: user.invite_sent_at,
            account_activated_at: user.account_activated_at,
          }}
          callerRole={callerRole}
          onSent={(p) => onUserUpdated?.({ id: p.id, email: p.email, invite_sent_at: p.invite_sent_at })}
        />
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
        callerRole={callerRole}
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
