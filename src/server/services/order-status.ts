import { OrderStatus, Role } from "@/generated/prisma/enums";

/**
 * Order preparation state machine (pure).
 *
 *   PENDING → CONFIRMED → PREPARING → READY → COMPLETED
 *      └──────────┴────────────┴──→ CANCELLED
 */
export const ORDER_FLOW: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  CONFIRMED: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  PREPARING: [OrderStatus.READY, OrderStatus.CANCELLED],
  READY: [OrderStatus.COMPLETED],
  COMPLETED: [],
  CANCELLED: [],
};

export const ACTIVE_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
];

export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = [OrderStatus.COMPLETED, OrderStatus.CANCELLED];

/** Statuses from which kitchen staff may cancel (e.g. an item cannot be made). */
const KITCHEN_CANCELLABLE: readonly OrderStatus[] = [OrderStatus.PENDING, OrderStatus.CONFIRMED];

export function isValidTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_FLOW[from].includes(to);
}

/** Role-aware transition check. Customers may only cancel pending orders. */
export function canTransition(role: Role, from: OrderStatus, to: OrderStatus): boolean {
  if (!isValidTransition(from, to)) return false;
  switch (role) {
    case Role.ADMIN:
      return true;
    case Role.KITCHEN_STAFF:
      return to !== OrderStatus.CANCELLED || KITCHEN_CANCELLABLE.includes(from);
    case Role.CUSTOMER:
      return from === OrderStatus.PENDING && to === OrderStatus.CANCELLED;
    default:
      return false;
  }
}

/** The single "advance" step used by the kitchen display, if any. */
export function nextForwardStatus(from: OrderStatus): OrderStatus | null {
  return ORDER_FLOW[from].find((status) => status !== OrderStatus.CANCELLED) ?? null;
}

export function allowedTransitions(role: Role, from: OrderStatus): OrderStatus[] {
  return ORDER_FLOW[from].filter((to) => canTransition(role, from, to));
}

export const STATUS_TIMESTAMP_FIELD: Partial<
  Record<OrderStatus, "confirmedAt" | "preparingAt" | "readyAt" | "completedAt" | "cancelledAt">
> = {
  CONFIRMED: "confirmedAt",
  PREPARING: "preparingAt",
  READY: "readyAt",
  COMPLETED: "completedAt",
  CANCELLED: "cancelledAt",
};

/** Whether a customer may still cancel, given the configured window. */
export function isWithinCancelWindow(placedAt: Date, windowMinutes: number, now = new Date()): boolean {
  if (windowMinutes <= 0) return false;
  return now.getTime() - placedAt.getTime() <= windowMinutes * 60_000;
}
