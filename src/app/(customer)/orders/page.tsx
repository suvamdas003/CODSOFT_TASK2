import type { Metadata } from "next";
import Link from "next/link";
import { OrderPaymentBadge, OrderStatusBadge } from "@/components/shared/status-badges";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, Pagination, Table, Td, Th } from "@/components/ui/display";
import { requireUser } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { firstParam, formatDateTime, formatOrderNumber, humanize } from "@/lib/utils";
import { pageSchema } from "@/lib/validation/common";
import { getSettings } from "@/server/repositories/settings-repository";
import { listOrdersForCustomer } from "@/server/services/order-service";

export const metadata: Metadata = { title: "My orders" };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser("/orders");
  const page = pageSchema.parse(firstParam((await searchParams).page));
  const [{ orders, pageCount }, settings] = await Promise.all([listOrdersForCustomer(user, page), getSettings()]);

  return (
    <div>
      <PageHeader title="My orders" description="Track current orders and view past receipts." />
      {orders.length === 0 ? (
        <EmptyState
          title="No orders yet"
          description="When you place an order it will appear here."
          action={
            <Link href="/menu" className={buttonVariants()}>
              Browse the menu
            </Link>
          }
        />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Order</Th>
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
                    <Link href={`/orders/${order.id}`} className="text-brand-700 font-medium hover:underline">
                      {formatOrderNumber(order.orderNumber)}
                    </Link>
                    <p className="text-xs text-stone-500">{order._count.items} line(s)</p>
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
          <Pagination page={page} pageCount={pageCount} basePath="/orders" params={{}} />
        </>
      )}
    </div>
  );
}
