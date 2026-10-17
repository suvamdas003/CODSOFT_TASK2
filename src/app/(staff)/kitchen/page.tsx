import type { Metadata } from "next";
import { StaffHeader } from "@/components/layout/staff-header";
import { KitchenBoard } from "@/features/kitchen/kitchen-board";
import { KITCHEN_ROLES } from "@/lib/auth/permissions";
import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/server/repositories/settings-repository";
import { listKitchenOrders } from "@/server/services/order-service";

export const metadata: Metadata = { title: "Kitchen display" };

export default async function KitchenPage() {
  const user = await requireRole(KITCHEN_ROLES, "/kitchen");
  const [orders, settings] = await Promise.all([listKitchenOrders(user), getSettings()]);
  const initialOrders = orders.map((order) => ({
    ...order,
    placedAt: order.placedAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  }));

  return (
    <>
      <StaffHeader user={user} area="Kitchen" />
      <main id="main" className="flex-1 bg-stone-100 px-4 py-6 sm:px-6">
        <h1 className="font-display mb-4 text-2xl font-semibold text-stone-900">Kitchen display</h1>
        <KitchenBoard initialOrders={initialOrders} role={user.role} lateMinutes={settings.kitchenLateMinutes} />
      </main>
    </>
  );
}
