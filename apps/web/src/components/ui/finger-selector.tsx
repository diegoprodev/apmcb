"use client";

interface Props {
  value: number | null;
  onChange: (fingerIndex: number) => void;
  disabled?: boolean;
}

const RIGHT_HAND = [
  { index: 5, label: "Min.", short: "Min" },
  { index: 4, label: "Anel", short: "Anel" },
  { index: 3, label: "Médio", short: "Méd" },
  { index: 2, label: "Indicador", short: "Ind" },
  { index: 1, label: "Polegar", short: "Pol" },
];

const LEFT_HAND = [
  { index: 6, label: "Polegar", short: "Pol" },
  { index: 7, label: "Indicador", short: "Ind" },
  { index: 8, label: "Médio", short: "Méd" },
  { index: 9, label: "Anel", short: "Anel" },
  { index: 10, label: "Mínimo", short: "Min" },
];

function FingerButton({
  index,
  label,
  short,
  selected,
  onClick,
  disabled,
}: {
  index: number;
  label: string;
  short: string;
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={`Dedo ${index} — ${label}`}
      aria-label={`Dedo ${index}: ${label}`}
      aria-pressed={selected}
      className={`
        flex flex-col items-center gap-1 group transition-all
        ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
      `}
    >
      {/* Finger visual */}
      <div
        className={`
          w-9 h-14 rounded-t-full rounded-b-lg border-2 transition-all flex items-end justify-center pb-1
          ${selected
            ? "bg-primary border-primary text-primary-foreground shadow-md scale-105"
            : "bg-muted border-border text-muted-foreground group-hover:border-primary/50 group-hover:bg-primary/10"
          }
          ${disabled ? "" : ""}
        `}
      >
        <span className="text-[9px] font-bold leading-none">{index}</span>
      </div>
      <span className={`text-[10px] leading-none ${selected ? "text-primary font-semibold" : "text-muted-foreground"}`}>
        {short}
      </span>
    </button>
  );
}

export function FingerSelector({ value, onChange, disabled }: Props) {
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-center gap-6">
        {/* Right hand */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-end gap-1.5">
            {RIGHT_HAND.map((f) => (
              <FingerButton
                key={f.index}
                index={f.index}
                label={f.label}
                short={f.short}
                selected={value === f.index}
                onClick={() => onChange(f.index)}
                disabled={disabled}
              />
            ))}
          </div>
          {/* Palm */}
          <div className="w-[11.5rem] h-8 rounded-b-xl bg-muted border border-border flex items-center justify-center">
            <span className="text-[10px] text-muted-foreground font-medium tracking-wide uppercase">
              Direita
            </span>
          </div>
        </div>

        {/* Left hand */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-end gap-1.5">
            {LEFT_HAND.map((f) => (
              <FingerButton
                key={f.index}
                index={f.index}
                label={f.label}
                short={f.short}
                selected={value === f.index}
                onClick={() => onChange(f.index)}
                disabled={disabled}
              />
            ))}
          </div>
          <div className="w-[11.5rem] h-8 rounded-b-xl bg-muted border border-border flex items-center justify-center">
            <span className="text-[10px] text-muted-foreground font-medium tracking-wide uppercase">
              Esquerda
            </span>
          </div>
        </div>
      </div>

      {value !== null && (
        <p className="text-center text-xs text-primary font-medium">
          Dedo {value} selecionado — {
            [...RIGHT_HAND, ...LEFT_HAND].find((f) => f.index === value)?.label
          } {value <= 5 ? "(Direita)" : "(Esquerda)"}
        </p>
      )}
    </div>
  );
}
