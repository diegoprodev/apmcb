export default function LoginPage() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-background">
      <div
        className="bg-card rounded-xl p-8 w-full max-w-sm"
        style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.08)" }}
      >
        <h1 className="text-xl font-semibold text-foreground mb-2">APMCB</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Academia de Polícia Militar do Cabo Branco
        </p>
        <p className="text-xs text-muted-foreground">Login em breve…</p>
      </div>
    </div>
  );
}
