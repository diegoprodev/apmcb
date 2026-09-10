import { getMaterialIdentityParts, type MaterialIdentityInput } from "@/lib/material-identity";
import { cn } from "@/lib/utils";

/**
 * Linha secundária de identificação de um material, usada em TODA listagem
 * de inventário/arsenal (grade, tabela, sheet de detalhe, seletores de saída
 * e de solicitação). A regra de "o que identifica este material" mora em
 * @/lib/material-identity — aqui só a apresentação.
 *
 * Hierarquia intencional: identificadores literais (placa, nº de série,
 * calibre) viram um chip monoespaçado, que é o que o olho procura ao varrer
 * a lista atrás de UM item específico; o descritivo (modelo, cor/ano,
 * contagem de unidades, descrição) fica em texto secundário logo depois.
 * Nada aqui compete em peso com o nome do material acima, nem com o
 * cabeçalho da categoria — o motivo de existir deste componente é
 * exatamente o oposto: uma linha que nunca pode ser lida como cabeçalho.
 */
export function MaterialIdentityLine({
  material,
  maxParts,
  className,
  testId = "material-identity",
}: {
  material: MaterialIdentityInput;
  maxParts?: number;
  className?: string;
  testId?: string;
}) {
  const parts = getMaterialIdentityParts(material, maxParts ? { maxParts } : undefined);
  if (parts.length === 0) return null;

  const codes = parts.filter((p) => p.kind === "code");
  const texts = parts.filter((p) => p.kind === "text");

  return (
    <span
      data-testid={testId}
      className={cn("mt-0.5 flex min-w-0 items-center gap-1.5", className)}
    >
      {codes.map((part) => (
        <span
          key={part.key}
          title={part.title}
          className="shrink-0 rounded border border-border/70 bg-muted/60 px-1.5 py-px font-mono text-[11px] font-semibold leading-4 tracking-tight text-foreground/80"
        >
          {part.value}
        </span>
      ))}
      {texts.length > 0 && (
        <span
          title={texts.find((p) => p.title)?.title}
          className="truncate text-[11px] leading-4 text-muted-foreground"
        >
          {texts.map((p) => p.value).join(" · ")}
        </span>
      )}
    </span>
  );
}
