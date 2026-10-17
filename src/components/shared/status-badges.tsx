import type { OrderPaymentStatus, OrderStatus, PaymentStatus, ReservationStatus } from "@/generated/prisma/enums";
import { Badge, type BadgeTone } from "@/components/ui/display";
import { humanize } from "@/lib/utils";

const ORDER_TONES: Record<OrderStatus, BadgeTone> = {
  PENDING: "amber",
  CONFIRMED: "blue",
  PREPARING: "purple",
  READY: "green",
  COMPLETED: "neutral",
  CANCELLED: "red",
};

const ORDER_PAYMENT_TONES: Record<OrderPaymentStatus, BadgeTone> = { UNPAID: "amber", PAID: "green", REFUNDED: "neutral" };

const PAYMENT_TONES: Record<PaymentStatus, BadgeTone> = {
  PENDING: "amber",
  PAID: "green",
  FAILED: "red",
  CANCELLED: "neutral",
  REFUNDED: "neutral",
};

const RESERVATION_TONES: Record<ReservationStatus, BadgeTone> = {
  PENDING: "amber",
  CONFIRMED: "green",
  SEATED: "blue",
  COMPLETED: "neutral",
  CANCELLED: "red",
  NO_SHOW: "red",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={ORDER_TONES[status]}>{humanize(status)}</Badge>;
}

export function OrderPaymentBadge({ status }: { status: OrderPaymentStatus }) {
  return <Badge tone={ORDER_PAYMENT_TONES[status]}>{humanize(status)}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <Badge tone={PAYMENT_TONES[status]}>{humanize(status)}</Badge>;
}

export function ReservationStatusBadge({ status }: { status: ReservationStatus }) {
  return <Badge tone={RESERVATION_TONES[status]}>{humanize(status)}</Badge>;
}
