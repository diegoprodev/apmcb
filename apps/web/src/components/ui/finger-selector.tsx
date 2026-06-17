"use client";

interface Props {
  value: number | null;
  onChange: (fingerIndex: number) => void;
  disabled?: boolean;
  registeredFingers?: number[];
}

const RIGHT_HAND = [
  { index: 5, label: "Mínimo",    short: "Min" },
  { index: 4, label: "Anel",      short: "Anel" },
  { index: 3, label: "Médio",     short: "Méd" },
  { index: 2, label: "Indicador", short: "Ind" },
  { index: 1, label: "Polegar",   short: "Pol" },
];

const LEFT_HAND = [
  { index: 6,  label: "Polegar",   short: "Pol" },
  { index: 7,  label: "Indicador", short: "Ind" },
  { index: 8,  label: "Médio",     short: "Méd" },
  { index: 9,  label: "Anel",      short: "Anel" },
  { index: 10, label: "Mínimo",    short: "Min" },
];

export const ALL_FINGERS = [...RIGHT_HAND, ...LEFT_HAND];

function FingerButton({
  index,
  label,
  short,
  selected,
  registered,
  onClick,
  disabled,
}: {
  index: number;
  label: string;
  short: string;
  selected: boolean;
  registered: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={`Dedo ${index} — ${label}${registered ? " (cadastrado)" : ""}`}
      aria-label={`Dedo ${index}: ${label}${registered ? " — cadastrado" : ""}`}
      aria-pressed={selected}
      className={`
        flex flex-col items-center gap-1 group transition-all
        ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
      `}
    >
      <div
        className={`
          w-9 h-14 rounded-t-full rounded-b-lg border-2 transition-all flex items-end justify-center pb-1
          ${selected
            ? "bg-primary border-primary text-primary-foreground shadow-md scale-105"
            : registered
              ? "bg-emerald-100 border-emerald-400 text-emerald-700"
              : "bg-muted border-border text-muted-foreground group-hover:border-primary/50 group-hover:bg-primary/10"
          }
        `}
      >
        <span className="text-[9px] font-bold leading-none">{index}</span>
      </div>
      <span
        className={`text-[10px] leading-none font-medium ${
          selected ? "text-primary" : registered ? "text-emerald-700" : "text-muted-foreground"
        }`}
      >
        {short}
      </span>
    </button>
  );
}

export function FingerSelector({ value, onChange, disabled, registeredFingers = [] }: Props) {
  const selectedFinger = ALL_FINGERS.find((f) => f.index === value);

  return (
    <div className="space-y-3">
      {registeredFingers.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-emerald-700">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-400" />
          {registeredFingers.length === 1 ? "1 dedo cadastrado" : `${registeredFingers.length} dedos cadastrados`}
        </div>
      )}
      <div className="flex items-end justify-center gap-4 sm:gap-6">
        {/* Right hand */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-end gap-1">
            {RIGHT_HAND.map((f) => (
              <FingerButton
                key={f.index}
                index={f.index}
                label={f.label}
                short={f.short}
                selected={value === f.index}
                registered={registeredFingers.includes(f.index)}
                onClick={() => onChange(f.index)}
                disabled={disabled}
              />
            ))}
          </div>
          <div className="w-44 h-8 rounded-b-xl bg-muted border border-border flex items-center justify-center">
            <span className="text-[10px] text-muted-foreground font-medium tracking-wide uppercase">
              Direita
            </span>
          </div>
        </div>

        {/* Left hand */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-end gap-1">
            {LEFT_HAND.map((f) => (
              <FingerButton
                key={f.index}
                index={f.index}
                label={f.label}
                short={f.short}
                selected={value === f.index}
                registered={registeredFingers.includes(f.index)}
                onClick={() => onChange(f.index)}
                disabled={disabled}
              />
            ))}
          </div>
          <div className="w-44 h-8 rounded-b-xl bg-muted border border-border flex items-center justify-center">
            <span className="text-[10px] text-muted-foreground font-medium tracking-wide uppercase">
              Esquerda
            </span>
          </div>
        </div>
      </div>

      {value !== null && (
        <p className="text-center text-xs text-primary font-medium">
          Dedo {value} selecionado — {selectedFinger?.label}{" "}
          {value <= 5 ? "(Direita)" : "(Esquerda)"}
          {registeredFingers.includes(value) && (
            <span className="text-emerald-700 ml-1">· já cadastrado</span>
          )}
        </p>
      )}
    </div>
  );
}
