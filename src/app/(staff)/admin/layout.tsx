import type { ReactNode } from "react";
import { AdminNav } from "@/components/layout/admin-nav";
import { StaffHeader } from "@/components/layout/staff-header";
import { ADMIN_ROLES } from "@/lib/auth/permissions";
import { requireRole } from "@/lib/auth/session";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Pages re-check the role themselves too; this guards the whole section.
  const user = await requireRole(ADMIN_ROLES, "/admin");
  return (
    <>
      <StaffHeader user={user} area="Admin" />
      <div className="flex flex-1 flex-col md:flex-row">
        <AdminNav />
        <main id="main" className="min-w-0 flex-1 bg-stone-50 px-4 py-6 sm:px-8">
          {children}
        </main>
      </div>
    </>
  );
}
