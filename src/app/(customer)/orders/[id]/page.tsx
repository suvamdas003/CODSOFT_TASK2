import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OrderPaymentBadge, OrderStatusBadge } from "@/components/shared/status-badges";
import { buttonVariants } from "@/components/ui/button";
import { Alert, Card, CardBody, CardHeader, PageHeader } from "@/components/ui/display";
import { OrderLines, OrderTimeline, orderTypeLabel, PaymentList } from "@/features/orders/order-details";
import { CancelOrderButton, OrderAutoRefresh, PaymentReturnSync, PayOnlineButton } from "@/features/orders/order-live";
import { requireUser } from "@/lib/auth/session";
import { NotFoundError } from "@/lib/errors";
import { formatDateTime, formatOrderNumber, minutesBetween } from "@/lib/utils";
import { getOnlinePaymentProvider } from "@/server/payments";
import { getSettings } from "@/server/repositories/settings-repository";
import { ACTIVE_ORDER_STATUSES } from "@/server/services/order-status";
import { getOrderForActor, type OrderDetail } from "@/server/services/order-service";

export const metadata: Metadata = { title: "Order details" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function OrderPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const user = await requireUser(`/orders/${id}`);
  let order: OrderDetail;
  try {
    order = await getOrderForActor(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const settings = await getSettings();
  const isOwner = order.customerId === user.id;
  const active = ACTIVE_ORDER_STATUSES.includes(order.status);
  const canCancel =
    isOwner &&
    order.status === "PENDING" &&
    order.paymentStatus === "UNPAID" &&
    settings.customerCancelWindowMinutes > 0 &&
    minutesBetween(order.placedAt) < settings.customerCancelWindowMinutes;
  const canPayOnline =
    isOwner &&
    order.paymentMethod === "ONLINE_CARD" &&
    order.paymentStatus === "UNPAID" &&
    order.status !== "CANCELLED" &&
    Boolean(getOnlinePaymentProvider());

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Order ${formatOrderNumber(order.orderNumber)}`}
        description={`Placed ${formatDateTime(order.placedAt, settings.timezone, settings.locale)} · ${orderTypeLabel(order)}`}
        actions={
          <>
            <Link href={`/orders/${order.id}/receipt`} className={buttonVariants({ variant: "outline" })}>
              Receipt
            </Link>
            {canCancel ? <CancelOrderButton orderId={order.id} /> : null}
          </>
        }
      />

      {query.placed ? (
        <Alert tone="success" title="Thank you — your order has been placed.">
          We&apos;ll update this page as the kitchen works on it.
        </Alert>
      ) : null}
      {query.paymentError ? (
        <Alert tone="warning">
          Your order was placed, but the online payment page could not be opened. Use “Pay online now” below to retry.
        </Alert>
      ) : null}
      {query.payment === "cancelled" ? <Alert tone="warning">Payment was not completed. You can try again below.</Alert> : null}
      {query.payment === "return" && isOwner ? <PaymentReturnSync orderId={order.id} /> : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader title="Items" />
          <CardBody>
            <OrderLines order={order} locale={settings.locale} />
            {order.notes ? (
              <p className="mt-4 rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">Order notes: {order.notes}</p>
            ) : null}
            {order.deliveryAddress ? <p className="mt-2 text-sm text-stone-700">Deliver to: {order.deliveryAddress}</p> : null}
          </CardBody>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Status" action={<OrderStatusBadge status={order.status} />} />
            <CardBody className="space-y-4">
              <OrderTimeline order={order} timezone={settings.timezone} locale={settings.locale} />
              <OrderAutoRefresh
                orderId={order.id}
                status={order.status}
                paymentStatus={order.paymentStatus}
                active={
                  active || (order.paymentMethod === "ONLINE_CARD" && order.paymentStatus === "UNPAID" && order.status !== "CANCELLED")
                }
              />
              {canCancel ? (
                <p className="text-xs text-stone-500">
                  You can cancel within {settings.customerCancelWindowMinutes} minutes of ordering, until the kitchen accepts it.
                </p>
              ) : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Payment" action={<OrderPaymentBadge status={order.paymentStatus} />} />
            <CardBody className="space-y-4">
              <p className="text-sm text-stone-700">
                Method: {order.paymentMethod === "CASH" ? "Pay at the restaurant" : "Online card payment"}
              </p>
              <PaymentList order={order} timezone={settings.timezone} locale={settings.locale} />
              {canPayOnline ? <PayOnlineButton orderId={order.id} /> : null}
              {order.paymentMethod === "ONLINE_CARD" && order.paymentStatus === "UNPAID" && !getOnlinePaymentProvider() ? (
                <Alert tone="warning">Online payments are currently unavailable. Please pay at the restaurant.</Alert>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
