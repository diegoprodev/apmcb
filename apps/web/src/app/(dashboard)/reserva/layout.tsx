import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

export default async function ReservaLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  if (cookieStore.get("apmcb_mode")?.value === "usuario") {
    redirect("/efetivo");
  }
  return <>{children}</>;
}
