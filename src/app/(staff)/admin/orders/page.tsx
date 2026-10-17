import type { Metadata } from "next";
import Link from "next/link";
import { OrderStatus, OrderType } from "@/generated/prisma/enums";
import { OrderPaymentBadge, OrderStatusBadge } from "@/components/shared/status-badges";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, Pagination, Table, Td, Th } from "@/components/ui/display";
import { Input, Select } from "@/components/ui/form-controls";
import { ADMIN_ROLES } from "@/lib/auth/permissions";
import { requireRole } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { firstParam, formatDateTime, formatOrderNumber, humanize } from "@/lib/utils";
import { orderListFilterSchema } from "@/lib/validation/order";
import { getSettings } from "@/server/repositories/settings-repository";
import { listOrdersForAdmin } from "@/server/services/order-service";

export const metadata: Metadata = { title: "Orders" };

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole(ADMIN_ROLES, "/admin/orders");
  const raw = await searchParams;
  const filters = orderListFilterSchema.parse({
    status: firstParam(raw.status) || undefined,
    type: firstParam(raw.type) || undefined,
    paymentStatus: firstParam(raw.paymentStatus) || undefined,
    q: firstParam(raw.q) || undefined,
    from: firstParam(raw.from) || undefined,
    to: firstParam(raw.to) || undefined,
    page: firstParam(raw.page),
  });
  const [{ orders, total, pageCount }, settings] = await Promise.all([listOrdersForAdmin(user, filters), getSettings()]);

  return (
    <div>
      <PageHeader title="Orders" description={`${total} order(s) match the current filters.`} />
      <form
        method="get"
        className="mb-4 grid gap-3 rounded-xl border border-stone-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-7"
        role="search"
      >
        <label className="lg:col-span-2">
          <span className="mb-1 block text-xs font-medium text-stone-600">Search</span>
          <Input name="q" defaultValue={filters.q} placeholder="Order no., name or email" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-stone-600">Status</span>
          <Select name="status" defaultValue={filters.status ?? ""}>
            <option value="">Any</option>
            {Object.values(OrderStatus).map((status) => (
              <option key={status} value={status}>
                {humanize(status)}
              </option>
            ))}
          </Select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-stone-600">Type</span>
          <Select name="type" defaultValue={filters.type ?? ""}>
            <option value="">Any</option>
            {Object.values(OrderType).map((type) => (
              <option key={type} value={type}>
                {humanize(type)}
              </option>
            ))}
          </Select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-stone-600">Payment</span>
          <Select name="paymentStatus" defaultValue={filters.paymentStatus ?? ""}>
            <option value="">Any</option>
            <option value="UNPAID">Unpaid</option>
            <option value="PAID">Paid</option>
            <option value="REFUNDED">Refunded</option>
          </Select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-stone-600">From</span>
          <Input type="date" name="from" defaultValue={filters.from} />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-stone-600">To</span>
          <Input type="date" name="to" defaultValue={filters.to} />
        </label>
        <div className="flex items-end gap-2 sm:col-span-3 lg:col-span-7">
          <button type="submit" className={buttonVariants({ variant: "secondary", size: "sm" })}>
            Apply filters
          </button>
          <Link href="/admin/orders" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Reset
          </Link>
        </div>
      </form>

      {orders.length === 0 ? (
        <EmptyState title="No orders found" description="Try widening the filters." />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Customer</Th>
                <Th>Placed</Th>
                <Th>Type</Th>
                <Th>Status</Th>
                <Th>Payment</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {orders.map((order) => (
                <tr key={order.id} className="hover:bg-stone-50">
                  <Td>
                    <Link href={`/admin/orders/${order.id}`} className="text-brand-700 font-medium hover:underline">
                      {formatOrderNumber(order.orderNumber)}
                    </Link>
                    <p className="text-xs text-stone-500">{order._count.items} line(s)</p>
                  </Td>
                  <Td>
                    {order.contactName}
                    <p className="text-xs text-stone-500">{order.customer.email}</p>
                  </Td>
                  <Td>{formatDateTime(order.placedAt, settings.timezone, settings.locale)}</Td>
                  <Td>{humanize(order.type)}</Td>
                  <Td>
                    <OrderStatusBadge status={order.status} />
                  </Td>
                  <Td>
                    <OrderPaymentBadge status={order.paymentStatus} />
                  </Td>
                  <Td className="text-right font-medium">{formatMoney(order.totalMinor, order.currency, settings.locale)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination
            page={filters.page}
            pageCount={pageCount}
            basePath="/admin/orders"
            params={{
              q: filters.q,
              status: filters.status,
              type: filters.type,
              paymentStatus: filters.paymentStatus,
              from: filters.from,
              to: filters.to,
            }}
          />
        </>
      )}
    </div>
  );
}
