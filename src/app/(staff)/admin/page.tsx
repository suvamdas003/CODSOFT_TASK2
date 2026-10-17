import type { Metadata } from "next";
import Link from "next/link";
import { OrderPaymentBadge, OrderStatusBadge } from "@/components/shared/status-badges";
import { Card, CardBody, CardHeader, EmptyState, PageHeader, StatCard, Table, Td, Th } from "@/components/ui/display";
import { SalesChart } from "@/features/admin/charts";
import { ADMIN_ROLES } from "@/lib/auth/permissions";
import { requireRole } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { formatOrderNumber, formatTime } from "@/lib/utils";
import { getSettings } from "@/server/repositories/settings-repository";
import { getDashboardSummary } from "@/server/services/report-service";

export const metadata: Metadata = { title: "Admin dashboard" };

export default async function AdminDashboard() {
  const user = await requireRole(ADMIN_ROLES, "/admin");
  const [summary, settings] = await Promise.all([getDashboardSummary(user), getSettings()]);
  const money = (minor: number) => formatMoney(minor, summary.currency, settings.locale);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={`Today (${summary.today}, ${settings.timezone}) — live figures from stored orders, payments and bookings.`}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Orders today" value={summary.ordersToday} hint={`${summary.activeOrders} active now`} />
        <StatCard label="Gross sales today" value={money(summary.grossTodayMinor)} hint="Non-cancelled orders placed today" />
        <StatCard
          label="Payments collected today"
          value={money(summary.collectedTodayMinor)}
          hint="Verified online + recorded manual payments"
        />
        <StatCard label="Reservations today" value={summary.reservationsToday} hint={`${summary.coversToday} guests expected`} />
      </div>
      {summary.unpaidActive > 0 ? (
        <p className="text-sm text-amber-800">
          {summary.unpaidActive} active order(s) are not yet paid.{" "}
          <Link href="/admin/orders?paymentStatus=UNPAID" className="font-medium underline">
            Review
          </Link>
        </p>
      ) : null}
      <Card>
        <CardHeader title="Gross sales — last 14 days" description="Daily total of non-cancelled orders." />
        <CardBody>
          <SalesChart data={summary.series} currency={summary.currency} locale={settings.locale} />
        </CardBody>
      </Card>
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-stone-900">Latest orders</h2>
          <Link href="/admin/orders" className="text-brand-700 text-sm font-medium hover:underline">
            All orders →
          </Link>
        </div>
        {summary.recentOrders.length === 0 ? (
          <EmptyState title="No orders yet" description="Orders will appear here as customers place them." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Customer</Th>
                <Th>Time</Th>
                <Th>Status</Th>
                <Th>Payment</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {summary.recentOrders.map((order) => (
                <tr key={order.id}>
                  <Td>
                    <Link href={`/admin/orders/${order.id}`} className="text-brand-700 font-medium hover:underline">
                      {formatOrderNumber(order.orderNumber)}
                    </Link>
                  </Td>
                  <Td>{order.contactName}</Td>
                  <Td>{formatTime(order.placedAt, settings.timezone, settings.locale)}</Td>
                  <Td>
                    <OrderStatusBadge status={order.status} />
                  </Td>
                  <Td>
                    <OrderPaymentBadge status={order.paymentStatus} />
                  </Td>
                  <Td className="text-right">{formatMoney(order.totalMinor, order.currency, settings.locale)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}
