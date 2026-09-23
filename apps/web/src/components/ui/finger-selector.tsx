"use client";

interface Props {
  value?: number | null;
  /** Sem onChange (ou com readOnly) a mão só mostra quais dedos já foram cadastrados. */
  onChange?: (fingerIndex: number) => void;
  readOnly?: boolean;
  disabled?: boolean;
  registeredFingers?: number[];
}

// Índices seguem o padrão do leitor (1-5 mão direita, do polegar ao mínimo;
// 6-10 mão esquerda, do polegar ao mínimo). Só a tela usa nomes — o número é
// detalhe interno e nunca aparece pro usuário.
const FINGER_LABELS = ["Polegar", "Indicador", "Médio", "Anelar", "Mínimo"] as const;

export const ALL_FINGERS = Array.from({ length: 10 }, (_, i) => {
  const index = i + 1;
  return { index, label: FINGER_LABELS[i % 5], short: FINGER_LABELS[i % 5] };
});

/** Ex.: 7 -> "Indicador esquerdo". Usado em botões e textos da tela. */
export function fingerName(index: number): string {
  const label = FINGER_LABELS[(index - 1) % 5];
  return `${label} ${index <= 5 ? "direito" : "esquerdo"}`;
}

// Geometria da MÃO ESQUERDA (palma virada pra quem olha, polegar à direita).
// A direita é o espelho exato (transform no grupo), com os índices 1-5.
interface FingerShape {
  leftIndex: number;
  rightIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
  transform?: string;
}

const FINGER_SHAPES: FingerShape[] = [
  { leftIndex: 10, rightIndex: 5, x: 24, y: 118, w: 28, h: 84, transform: "rotate(-7 38 202)" },
  { leftIndex: 9, rightIndex: 4, x: 57, y: 76, w: 31, h: 126, transform: "rotate(-3 72 202)" },
  { leftIndex: 8, rightIndex: 3, x: 93, y: 60, w: 33, h: 142 },
  { leftIndex: 7, rightIndex: 2, x: 131, y: 78, w: 31, h: 124, transform: "rotate(3 146 202)" },
  { leftIndex: 6, rightIndex: 1, x: -16, y: -80, w: 32, h: 124, transform: "translate(172 224) rotate(38)" },
];

const PALM_FILL = "M22 168 H166 L180 204 C186 242 160 272 112 276 C66 279 30 256 22 214 Z";
const PALM_OUTLINE = "M22 168 C20 186 20 200 22 214 C30 256 66 279 112 276 C160 272 186 242 180 204";

function fingerPath({ x, y, w, h }: FingerShape): string {
  const r = w / 2;
  return `M${x} ${y + h} L${x} ${y + r} A${r} ${r} 0 0 1 ${x + w} ${y + r} L${x + w} ${y + h} Z`;
}

function Hand({
  side,
  value,
  onChange,
  disabled,
  registeredFingers,
}: {
  side: "left" | "right";
  value: number | null;
  onChange?: (fingerIndex: number) => void;
  disabled?: boolean;
  registeredFingers: number[];
}) {
  const interactive = Boolean(onChange) && !disabled;
  return (
    <>
      {FINGER_SHAPES.map((shape) => {
        const index = side === "left" ? shape.leftIndex : shape.rightIndex;
        const selected = value === index;
        const registered = registeredFingers.includes(index);
        const name = fingerName(index);
        const cx = shape.x + shape.w / 2;
        const tipY = shape.y + shape.w / 2;
        return (
          <g key={index} transform={shape.transform}>
            <g
              role={onChange ? "button" : "img"}
              tabIndex={interactive ? 0 : undefined}
              aria-label={`${name}${registered ? " — cadastrado" : ""}`}
              aria-pressed={onChange ? selected : undefined}
              aria-disabled={onChange ? disabled : undefined}
              onClick={() => { if (interactive) onChange!(index); }}
              onKeyDown={(e) => {
                if (!interactive) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onChange!(index);
                }
              }}
              className={`outline-none group ${disabled ? "cursor-not-allowed opacity-50" : interactive ? "cursor-pointer" : ""}`}
            >
              <title>{`${name}${registered ? " (cadastrado)" : ""}`}</title>
              <path
                d={fingerPath(shape)}
                strokeWidth={2.5}
                strokeLinejoin="round"
                className={`transition-colors group-focus-visible:stroke-ring ${
                  selected
                    ? "fill-primary stroke-primary"
                    : registered
                      ? "fill-emerald-200 stroke-emerald-500 dark:fill-emerald-900 dark:stroke-emerald-500"
                      : interactive
                        ? "fill-muted stroke-border group-hover:fill-primary/15 group-hover:stroke-primary/60"
                        : "fill-muted stroke-border"
                }`}
              />
              {/* Digital estilizada na ponta do dedo */}
              <path
                d={`M${cx - 8} ${tipY + 12} a8 8 0 0 1 16 0 M${cx - 4} ${tipY + 12} a4 4 0 0 1 8 0 M${cx - 12} ${tipY + 16} a12 12 0 0 1 24 0`}
                fill="none"
                strokeWidth={1.6}
                strokeLinecap="round"
                className={selected ? "stroke-primary-foreground/80" : registered ? "stroke-emerald-600/70" : "stroke-muted-foreground/40"}
              />
            </g>
          </g>
        );
      })}
      <path d={PALM_FILL} className="fill-muted" />
      <path d={PALM_OUTLINE} fill="none" strokeWidth={2.5} strokeLinecap="round" className="stroke-border" />
    </>
  );
}

export function FingerSelector({ value = null, onChange, readOnly, disabled, registeredFingers = [] }: Props) {
  const handler = readOnly ? undefined : onChange;
  return (
    <div className="space-y-3 w-full">
      {registeredFingers.length > 0 && (
        <div className="flex items-center justify-center gap-1.5 text-xs text-emerald-700">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-400" />
          {registeredFingers.length === 1 ? "1 dedo cadastrado" : `${registeredFingers.length} dedos cadastrados`}
        </div>
      )}

      <svg viewBox="0 0 480 296" className="mx-auto w-full max-w-md" role="group" aria-label={handler ? "Selecione o dedo" : "Dedos cadastrados"}>
        <Hand side="left" value={value} onChange={handler} disabled={disabled} registeredFingers={registeredFingers} />
        <g transform="translate(480 0) scale(-1 1)">
          <Hand side="right" value={value} onChange={handler} disabled={disabled} registeredFingers={registeredFingers} />
        </g>
        <text x="115" y="292" textAnchor="middle" fontSize="13" className="fill-muted-foreground font-medium">
          Mão esquerda
        </text>
        <text x="365" y="292" textAnchor="middle" fontSize="13" className="fill-muted-foreground font-medium">
          Mão direita
        </text>
      </svg>

      {value !== null && (
        <p className="text-center text-xs text-primary font-medium">
          {fingerName(value)} selecionado
          {registeredFingers.includes(value) && (
            <span className="text-emerald-700 ml-1">· já cadastrado</span>
          )}
        </p>
      )}
    </div>
  );
}
