// Teste de regressão do achado ALTO de code review (lote UX Fases 6-8):
// AlertDialog renderizado como IRMÃO de Dialog sob um Fragment (`<>...</>`)
// não é contado como "nested" pelo base-ui (`DialogRootContext` só soma
// `ownNestedOpenDialogs` quando o filho está de fato dentro da árvore React
// do `DialogContent`/Popup do pai) — os dois registram listener de Escape
// próprio no `document`, e o do Dialog pai também dispara, fechando o
// formulário inteiro e perdendo o que o usuário digitou. Fix aplicado em
// `_edit-dialog.tsx`/`_cadastrar-militar-dialog.tsx`: mover o `<AlertDialog>`
// pra dentro do `<DialogContent>` do pai. Este arquivo prova que, nessa
// estrutura correta, Escape no AlertDialog fecha só ele — não o Dialog pai —
// e cobre o contrato "burro" de AlertDialogAction/AlertDialogCancel (Fase 7).
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Dialog, DialogContent, DialogTitle } from "./dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "./alert-dialog";

afterEach(cleanup);

// Mesma estrutura de _edit-dialog.tsx/_cadastrar-militar-dialog.tsx pós-fix:
// AlertDialog aninhado DENTRO do DialogContent do Dialog pai.
function NestedFixture({
  onParentOpenChange,
  onAction,
}: {
  onParentOpenChange: (open: boolean) => void;
  onAction?: () => void;
}) {
  const [alertOpen, setAlertOpen] = useState(true);
  return (
    <Dialog open onOpenChange={onParentOpenChange}>
      <DialogContent>
        <DialogTitle>Editar usuário</DialogTitle>
        <AlertDialog open={alertOpen} onOpenChange={setAlertOpen}>
          <AlertDialogContent>
            <AlertDialogTitle>Alterar e-mail de acesso?</AlertDialogTitle>
            <AlertDialogDescription>Confirma a troca?</AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={onAction}>Confirmar alteração</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

describe("AlertDialog aninhado em DialogContent (regressão ALTO — Escape)", () => {
  it("Escape fecha só o AlertDialog, não o Dialog pai (não perde o formulário)", async () => {
    const onParentOpenChange = vi.fn();
    render(<NestedFixture onParentOpenChange={onParentOpenChange} />);

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    // O achado real: sem o aninhamento correto, isto disparava com `false`
    // e fechava o Dialog pai (form inteiro) junto com o AlertDialog.
    expect(onParentOpenChange).not.toHaveBeenCalledWith(false);
    // O formulário continua na tela.
    expect(screen.getByText("Editar usuário")).toBeInTheDocument();
  });

  it("Escape fecha o AlertDialog em si", () => {
    render(<NestedFixture onParentOpenChange={vi.fn()} />);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

describe("AlertDialogAction / AlertDialogCancel — componentes burros", () => {
  it("AlertDialogCancel fecha o AlertDialog (via onOpenChange), sem chamar onClick de Action", () => {
    const onAction = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <AlertDialog open onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogTitle>Excluir?</AlertDialogTitle>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={onAction}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    // base-ui chama onOpenChange(open, eventDetails) — o 2º argumento é um
    // objeto de detalhes do evento (reason/event/etc.), não documentado como
    // parte do contrato que os call sites do projeto consomem (todos usam só
    // o 1º argumento). Checar por posição, não por igualdade estrita da
    // chamada inteira.
    expect(onOpenChange).toHaveBeenCalled();
    expect(onOpenChange.mock.calls[0][0]).toBe(false);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("AlertDialogAction só dispara onClick — não fecha o diálogo sozinho (quem decide é o caller)", () => {
    const onAction = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <AlertDialog open onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogTitle>Excluir?</AlertDialogTitle>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={onAction}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));

    expect(onAction).toHaveBeenCalledTimes(1);
    // Componente "burro": não fecha por conta própria — o caller decide
    // (ex: só fechar em caso de sucesso, mantendo o dialog aberto com
    // spinner durante o await, ver _edit-dialog.tsx/_arsenal-client.tsx).
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("disabled bloqueia clique tanto em Action quanto em Cancel", () => {
    const onAction = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <AlertDialog open onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogTitle>Excluir?</AlertDialogTitle>
          <AlertDialogFooter>
            <AlertDialogCancel disabled>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={onAction} disabled>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onAction).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("clique no backdrop não fecha (alert-dialog força modal + disablePointerDismissal)", () => {
    const onOpenChange = vi.fn();
    const { container } = render(
      <AlertDialog open onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogTitle>Excluir?</AlertDialogTitle>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={vi.fn()}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );

    const backdrop = container.ownerDocument.querySelector('[data-slot="alert-dialog-overlay"]');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);

    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
