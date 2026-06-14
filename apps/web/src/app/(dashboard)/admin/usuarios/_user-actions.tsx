"use client";

import { useState } from "react";
import { Pencil, UserX, UserPlus, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditUserDialog } from "./_edit-dialog";
import { DeactivateUserDialog } from "./_deactivate-dialog";
import { CreateUserDialog } from "./_create-user-dialog";
import { CadastrarMilitarDialog } from "./_cadastrar-militar-dialog";

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

/**
 * Dois botões de ação distintos na toolbar de Usuários:
 *
 * [+ Cadastrar Militar]  — Registra o militar no sistema SEM credenciais de login.
 *                          Útil para controle de materiais, biometria etc.
 *
 * [Criar Login]          — Provisiona acesso ao sistema (e-mail + magic link ou senha).
 *                          O militar recebe convite ou credencial imediata.
 */
export function AdminUserToolbar() {
  const [cadastrarOpen, setCadastrarOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => setCadastrarOpen(true)}
        >
          <UserPlus className="size-4" />
          Cadastrar Militar
        </Button>

        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => setLoginOpen(true)}
        >
          <KeyRound className="size-4" />
          Criar Login
        </Button>
      </div>

      <CadastrarMilitarDialog
        open={cadastrarOpen}
        onClose={() => setCadastrarOpen(false)}
      />
      <CreateUserDialog
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
      />
    </>
  );
}
