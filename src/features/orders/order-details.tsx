import { Check, Circle } from "lucide-react";
import { OrderStatus } from "@/generated/prisma/enums";
import { PaymentStatusBadge } from "@/components/shared/status-badges";
import { formatMoney } from "@/lib/money";
import { cn, formatDateTime, humanize } from "@/lib/utils";
import type { OrderDetail } from "@/server/services/order-service";

type AddOnSnapshot = { name: string; priceMinor: number };

function addOnList(value: unknown): AddOnSnapshot[] {
  return Array.isArray(value) ? (value as AddOnSnapshot[]).filter((entry) => typeof entry?.name === "string") : [];
}

/** Itemised lines and totals, rendered from the order's own snapshots. */
export function OrderLines({ order, locale }: { order: OrderDetail; locale: string }) {
  const money = (minor: number) => formatMoney(minor, order.currency, locale);
  return (
    <div>
      <ul className="divide-y divide-stone-100">
        {order.items.map((item) => (
          <li key={item.id} className="flex justify-between gap-4 py-3 text-sm">
            <div>
              <p className="font-medium text-stone-900">
                {item.quantity} × {item.nameSnapshot}
                {item.variantName ? <span className="font-normal text-stone-600"> ({item.variantName})</span> : null}
              </p>
              {addOnList(item.addOns).length ? (
                <p className="text-stone-600">
                  +{" "}
                  {addOnList(item.addOns)
                    .map((addOn) => addOn.name)
                    .join(", ")}
                </p>
              ) : null}
              {item.notes ? <p className="text-stone-500 italic">“{item.notes}”</p> : null}
              <p className="text-xs text-stone-500">{money(item.unitPriceMinor)} each</p>
            </div>
            <p className="font-medium whitespace-nowrap text-stone-900">{money(item.lineTotalMinor)}</p>
          </li>
        ))}
      </ul>
      <dl className="mt-3 space-y-1.5 border-t border-stone-200 pt-3 text-sm">
        <TotalRow label="Subtotal" value={money(order.subtotalMinor)} />
        {order.discountMinor ? (
          <TotalRow label={`Discount${order.discountCode ? ` (${order.discountCode})` : ""}`} value={`− ${money(order.discountMinor)}`} />
        ) : null}
        {order.serviceChargeMinor ? (
          <TotalRow label={`Service charge (${order.serviceChargeBps / 100}%)`} value={money(order.serviceChargeMinor)} />
        ) : null}
        <TotalRow label={`Tax (${order.taxRateBps / 100}%)`} value={money(order.taxMinor)} />
        {order.deliveryFeeMinor ? <TotalRow label="Delivery fee" value={money(order.deliveryFeeMinor)} /> : null}
        <div className="flex justify-between pt-1 text-base font-semibold text-stone-900">
          <dt>Total</dt>
          <dd>{money(order.totalMinor)}</dd>
        </div>
      </dl>
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-stone-700">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

const STEPS: OrderStatus[] = [OrderStatus.PENDING, OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY, OrderStatus.COMPLETED];
const STEP_LABELS: Record<string, string> = {
  PENDING: "Order placed",
  CONFIRMED: "Accepted by kitchen",
  PREPARING: "Being prepared",
  READY: "Ready",
  COMPLETED: "Completed",
};

/** Progress steps with the timestamp of each recorded status change. */
export function OrderTimeline({ order, timezone, locale }: { order: OrderDetail; timezone: string; locale: string }) {
  const eventAt = new Map(order.statusEvents.map((event) => [event.toStatus, event.createdAt]));
  if (order.status === OrderStatus.CANCELLED) {
    const cancelled = order.statusEvents.find((event) => event.toStatus === OrderStatus.CANCELLED);
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        <p className="font-semibold">Order cancelled</p>
        {cancelled ? <p>{formatDateTime(cancelled.createdAt, timezone, locale)}</p> : null}
        {order.cancelReason ? <p className="mt-1">Reason: {order.cancelReason}</p> : null}
      </div>
    );
  }
  const currentIndex = STEPS.indexOf(order.status);
  return (
    <ol className="space-y-3" aria-label="Order progress">
      {STEPS.map((step, index) => {
        const done = index <= currentIndex;
        const at = eventAt.get(step);
        return (
          <li key={step} className="flex items-start gap-3" aria-current={index === currentIndex ? "step" : undefined}>
            <span
              className={cn(
                "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                done ? "bg-emerald-600 text-white" : "border-2 border-stone-300 text-stone-300",
              )}
            >
              {done ? <Check className="h-4 w-4" aria-hidden /> : <Circle className="h-2 w-2 fill-current" aria-hidden />}
            </span>
            <div>
              <p className={cn("text-sm font-medium", done ? "text-stone-900" : "text-stone-500")}>
                {STEP_LABELS[step]}
                <span className="sr-only">{done ? " (done)" : " (upcoming)"}</span>
              </p>
              {at ? <p className="text-xs text-stone-500">{formatDateTime(at, timezone, locale)}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function PaymentList({ order, timezone, locale }: { order: OrderDetail; timezone: string; locale: string }) {
  if (!order.payments.length) return <p className="text-sm text-stone-500">No payment records yet.</p>;
  return (
    <ul className="space-y-3 text-sm">
      {order.payments.map((payment) => (
        <li key={payment.id} className="rounded-lg border border-stone-200 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-stone-900">
              {payment.provider === "MANUAL" ? "Manual / at restaurant" : "Online card (Stripe)"} ·{" "}
              {formatMoney(payment.amountMinor, payment.currency, locale)}
            </span>
            <PaymentStatusBadge status={payment.status} />
          </div>
          <div className="mt-1 space-y-0.5 text-xs text-stone-500">
            {payment.transactionRef ? <p>Reference: {payment.transactionRef}</p> : null}
            {payment.paidAt ? <p>Paid {formatDateTime(payment.paidAt, timezone, locale)}</p> : null}
            {payment.provider === "MANUAL" && payment.status === "PAID" ? (
              <p>Recorded manually by staff{payment.recordedBy ? ` (${payment.recordedBy.name})` : ""} — not an online transaction.</p>
            ) : null}
            {payment.failureReason ? <p>{payment.failureReason}</p> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function orderTypeLabel(order: Pick<OrderDetail, "type" | "table">) {
  return order.type === "DINE_IN" && order.table ? `Dine-in · Table ${order.table.label}` : humanize(order.type);
}
