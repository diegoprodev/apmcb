import Link from "next/link";

export default function AuthErrorPage() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-background px-4">
      <div
        className="w-full max-w-[360px] bg-card rounded-2xl p-8 text-center space-y-4"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <p className="text-2xl">⚠️</p>
        <h2 className="text-lg font-semibold">Falha na autenticação</h2>
        <p className="text-sm text-muted-foreground">
          Não foi possível completar o login. Tente novamente.
        </p>
        <Link
          href="/login"
          className="inline-block mt-2 text-sm font-medium text-primary hover:underline"
        >
          Voltar para o login
        </Link>
      </div>
    </div>
  );
}
