export const runtime = "edge";
// Proxy repassa o cookie do caller — sem isso o Next pode cachear e servir a
// resposta autenticada de um usuário para outro.
export const dynamic = "force-dynamic";

const BFF = process.env.NEXT_PUBLIC_BFF_URL ?? "";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const qs = searchParams.toString();
  const res = await fetch(`${BFF}/api/nexus/errors${qs ? `?${qs}` : ""}`, {
    headers: {
      cookie: request.headers.get("cookie") ?? "",
      "x-csrf-token": request.headers.get("x-csrf-token") ?? "",
    },
    credentials: "include",
  });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
