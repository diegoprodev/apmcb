export const runtime = "edge";

const BFF = process.env.NEXT_PUBLIC_BFF_URL ?? "";

export async function POST(request: Request) {
  const body = await request.json();
  const res = await fetch(`${BFF}/api/nexus/clear-rate-limit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: request.headers.get("cookie") ?? "",
      "x-csrf-token": request.headers.get("x-csrf-token") ?? "",
    },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
