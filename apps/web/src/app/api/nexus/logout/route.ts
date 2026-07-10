
const BFF = process.env.NEXT_PUBLIC_BFF_URL ?? "";

export async function POST(request: Request) {
  const res = await fetch(`${BFF}/api/nexus/logout`, {
    method: "POST",
    headers: {
      cookie: request.headers.get("cookie") ?? "",
      "x-csrf-token": request.headers.get("x-csrf-token") ?? "",
      "Content-Type": "application/json",
    },
    credentials: "include",
  });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
