export const runtime = "edge";

const BFF = process.env.NEXT_PUBLIC_BFF_URL ?? "";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const qs = searchParams.toString();
  const res = await fetch(`${BFF}/api/nexus/events${qs ? `?${qs}` : ""}`, {
    headers: {
      cookie: request.headers.get("cookie") ?? "",
      "x-csrf-token": request.headers.get("x-csrf-token") ?? "",
    },
    credentials: "include",
  });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
