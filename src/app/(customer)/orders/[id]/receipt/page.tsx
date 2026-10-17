import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OrderPaymentBadge } from "@/components/shared/status-badges";
import { Card } from "@/components/ui/display";
import { OrderLines, orderTypeLabel, PaymentList } from "@/features/orders/order-details";
import { PrintButton } from "@/features/orders/order-live";
import { requireUser } from "@/lib/auth/session";
import { NotFoundError } from "@/lib/errors";
import { formatDateTime, formatOrderNumber } from "@/lib/utils";
import { getSettings } from "@/server/repositories/settings-repository";
import { getOrderForActor, type OrderDetail } from "@/server/services/order-service";

export const metadata: Metadata = { title: "Receipt" };

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/orders/${id}/receipt`);
  let order: OrderDetail;
  try {
    order = await getOrderForActor(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const settings = await getSettings();

  return (
    <div className="mx-auto max-w-xl">
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/orders/${order.id}`} className="text-brand-700 text-sm font-medium hover:underline">
          ← Back to order
        </Link>
        <PrintButton />
      </div>
      <Card className="p-8 print:border-0 print:shadow-none">
        <header className="border-b border-stone-200 pb-4 text-center">
          <h1 className="font-display text-2xl font-semibold">{settings.name}</h1>
          {settings.address ? <p className="text-sm text-stone-600">{settings.address}</p> : null}
          {settings.phone ? <p className="text-sm text-stone-600">{settings.phone}</p> : null}
        </header>
        <dl className="grid grid-cols-2 gap-y-1 py-4 text-sm">
          <dt className="text-stone-500">Receipt for order</dt>
          <dd className="text-right font-medium">{formatOrderNumber(order.orderNumber)}</dd>
          <dt className="text-stone-500">Date</dt>
          <dd className="text-right">{formatDateTime(order.placedAt, settings.timezone, settings.locale)}</dd>
          <dt className="text-stone-500">Customer</dt>
          <dd className="text-right">{order.contactName}</dd>
          <dt className="text-stone-500">Order type</dt>
          <dd className="text-right">{orderTypeLabel(order)}</dd>
          <dt className="text-stone-500">Payment status</dt>
          <dd className="text-right">
            <OrderPaymentBadge status={order.paymentStatus} />
          </dd>
        </dl>
        <OrderLines order={order} locale={settings.locale} />
        <section className="mt-6 border-t border-stone-200 pt-4">
          <h2 className="mb-2 text-sm font-semibold text-stone-900">Payments</h2>
          <PaymentList order={order} timezone={settings.timezone} locale={settings.locale} />
        </section>
        <p className="mt-6 text-center text-xs text-stone-500">
          Amounts in {order.currency}. Prices reflect the menu at the time of ordering.
          {order.paymentStatus === "UNPAID" ? " This order has not been paid yet." : ""}
        </p>
      </Card>
    </div>
  );
}
