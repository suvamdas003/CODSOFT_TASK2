import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OrderPaymentBadge, OrderStatusBadge } from "@/components/shared/status-badges";
import { buttonVariants } from "@/components/ui/button";
import { Alert, Card, CardBody, CardHeader, PageHeader } from "@/components/ui/display";
import { AdminOrderStatusControls, ManualPaymentForm, RefundButton } from "@/features/admin/order-admin";
import { OrderLines, OrderTimeline, orderTypeLabel, PaymentList } from "@/features/orders/order-details";
import { ADMIN_ROLES } from "@/lib/auth/permissions";
import { requireRole } from "@/lib/auth/session";
import { NotFoundError } from "@/lib/errors";
import { formatDateTime, formatOrderNumber, humanize } from "@/lib/utils";
import { getSettings } from "@/server/repositories/settings-repository";
import { allowedTransitions } from "@/server/services/order-status";
import { getOrderForActor, type OrderDetail } from "@/server/services/order-service";

export const metadata: Metadata = { title: "Order" };

export default async function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireRole(ADMIN_ROLES, `/admin/orders/${id}`);
  let order: OrderDetail;
  try {
    order = await getOrderForActor(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const settings = await getSettings();
  const paidPayments = order.payments.filter((payment) => payment.status === "PAID");

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Order ${formatOrderNumber(order.orderNumber)}`}
        description={`${orderTypeLabel(order)} · placed ${formatDateTime(order.placedAt, settings.timezone, settings.locale)}`}
        actions={
          <>
            <Link href={`/orders/${order.id}/receipt`} className={buttonVariants({ variant: "outline" })}>
              Printable receipt
            </Link>
            <Link href="/admin/orders" className={buttonVariants({ variant: "ghost" })}>
              ← All orders
            </Link>
          </>
        }
      />
      {paidPayments.length > 0 && order.status === "CANCELLED" ? (
        <Alert tone="warning" title="Refund required">
          This order was cancelled after being paid. Refund the customer, then use “Mark refunded” below.
        </Alert>
      ) : null}
      {paidPayments.length > 1 ? (
        <Alert tone="warning" title="Paid more than once">
          {paidPayments.length} payments are marked paid for this order. Refund the duplicate payment and mark it refunded.
        </Alert>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Items" />
            <CardBody>
              <OrderLines order={order} locale={settings.locale} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Customer & delivery" />
            <CardBody>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-stone-500">Contact name</dt>
                  <dd className="font-medium">{order.contactName}</dd>
                </div>
                <div>
                  <dt className="text-stone-500">Account</dt>
                  <dd>{order.customer.email}</dd>
                </div>
                <div>
                  <dt className="text-stone-500">Phone</dt>
                  <dd>{order.contactPhone ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-stone-500">Payment method</dt>
                  <dd>{humanize(order.paymentMethod)}</dd>
                </div>
                {order.deliveryAddress ? (
                  <div className="sm:col-span-2">
                    <dt className="text-stone-500">Delivery address</dt>
                    <dd>{order.deliveryAddress}</dd>
                  </div>
                ) : null}
                {order.notes ? (
                  <div className="sm:col-span-2">
                    <dt className="text-stone-500">Notes</dt>
                    <dd>{order.notes}</dd>
                  </div>
                ) : null}
              </dl>
            </CardBody>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Preparation status" action={<OrderStatusBadge status={order.status} />} />
            <CardBody className="space-y-4">
              <OrderTimeline order={order} timezone={settings.timezone} locale={settings.locale} />
              <AdminOrderStatusControls
                orderId={order.id}
                status={order.status}
                transitions={allowedTransitions(user.role, order.status)}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Payment" action={<OrderPaymentBadge status={order.paymentStatus} />} />
            <CardBody className="space-y-4">
              <PaymentList order={order} timezone={settings.timezone} locale={settings.locale} />
              {order.paymentStatus === "UNPAID" && order.status !== "CANCELLED" ? <ManualPaymentForm orderId={order.id} /> : null}
              {paidPayments.map((payment) => (
                <div key={payment.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-stone-600">
                    {payment.provider === "MANUAL" ? "Manual payment" : "Online payment"} {payment.transactionRef ?? ""}
                  </span>
                  <RefundButton paymentId={payment.id} orderId={order.id} online={payment.provider === "STRIPE"} />
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
