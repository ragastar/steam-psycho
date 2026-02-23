import { redirect } from "next/navigation";
import { verifySession } from "@/lib/admin/auth";
import Sidebar from "@/components/admin/Sidebar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const isAuth = await verifySession();
  if (!isAuth) redirect("/admin/login");

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
