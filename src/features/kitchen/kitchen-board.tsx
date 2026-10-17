"use client";

import { AlertTriangle, Clock, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { OrderStatus, type OrderType, type Role } from "@/generated/prisma/enums";
import { OrderStatusBadge } from "@/components/shared/status-badges";
import { Button } from "@/components/ui/button";
import { Alert, Badge, EmptyState } from "@/components/ui/display";
import { ConfirmButton } from "@/components/ui/interactive";
import { updateOrderStatusAction } from "@/features/orders/actions";
import { cn, formatOrderNumber, humanize } from "@/lib/utils";
import { canTransition, nextForwardStatus } from "@/server/services/order-status";

type KitchenOrderJson = {
  id: string;
  orderNumber: number;
  type: OrderType;
  status: OrderStatus;
  paymentStatus: string;
  contactName: string;
  notes: string | null;
  placedAt: string;
  table: { label: string } | null;
  items: { id: string; nameSnapshot: string; variantName: string | null; addOns: unknown; quantity: number; notes: string | null }[];
};

const POLL_MS = 5_000;

const FILTERS = [
  { key: "active", label: "All active", statuses: [OrderStatus.PENDING, OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY] },
  { key: "new", label: "New", statuses: [OrderStatus.PENDING] },
  { key: "queued", label: "Accepted", statuses: [OrderStatus.CONFIRMED] },
  { key: "preparing", label: "Preparing", statuses: [OrderStatus.PREPARING] },
  { key: "ready", label: "Ready", statuses: [OrderStatus.READY] },
  { key: "done", label: "Recently done", statuses: [OrderStatus.COMPLETED, OrderStatus.CANCELLED] },
] as const;

const FORWARD_LABEL: Partial<Record<OrderStatus, string>> = {
  CONFIRMED: "Accept",
  PREPARING: "Start preparing",
  READY: "Mark ready",
  COMPLETED: "Complete / hand over",
};

function addOnNames(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => (entry as { name?: string })?.name).filter((name): name is string => Boolean(name))
    : [];
}

export function KitchenBoard({ initialOrders, role, lateMinutes }: { initialOrders: KitchenOrderJson[]; role: Role; lateMinutes: number }) {
  const router = useRouter();
  const [orders, setOrders] = useState(initialOrders);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("active");
  const [typeFilter, setTypeFilter] = useState<OrderType | "ALL">("ALL");
  const [now, setNow] = useState(() => Date.now());
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/kitchen/orders", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        router.push("/login?next=/kitchen");
        return;
      }
      if (!response.ok) throw new Error();
      const data = (await response.json()) as { orders: KitchenOrderJson[] };
      setOrders(data.orders);
      setOffline(false);
      setLastSync(new Date());
    } catch {
      setOffline(true);
    }
  }, [router]);

  useEffect(() => {
    const poll = setInterval(() => {
      if (!document.hidden) void refresh();
    }, POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [refresh]);

  const statuses: readonly OrderStatus[] = FILTERS.find((entry) => entry.key === filter)!.statuses;
  const visible = useMemo(
    () => orders.filter((order) => statuses.includes(order.status) && (typeFilter === "ALL" || order.type === typeFilter)),
    [orders, statuses, typeFilter],
  );
  const counts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map((entry) => [
          entry.key,
          orders.filter((order) => (entry.statuses as readonly OrderStatus[]).includes(order.status)).length,
        ]),
      ),
    [orders],
  );

  async function move(order: KitchenOrderJson, toStatus: OrderStatus, reason?: string): Promise<string | null> {
    setError(null);
    setPendingIds((ids) => new Set(ids).add(order.id));
    const result = await updateOrderStatusAction({ orderId: order.id, expectedStatus: order.status, toStatus, reason });
    setPendingIds((ids) => {
      const nextIds = new Set(ids);
      nextIds.delete(order.id);
      return nextIds;
    });
    await refresh();
    if (!result.ok) {
      setError(`${formatOrderNumber(order.orderNumber)}: ${result.error}`);
      return result.error;
    }
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Order status filter">
          {FILTERS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={filter === entry.key}
              onClick={() => setFilter(entry.key)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm font-medium",
                filter === entry.key
                  ? "border-stone-900 bg-stone-900 text-white"
                  : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50",
              )}
            >
              {entry.label} <span className="ml-1 opacity-70">{counts[entry.key]}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="type-filter" className="text-sm text-stone-600">
            Type
          </label>
          <select
            id="type-filter"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as OrderType | "ALL")}
            className="h-9 rounded-lg border border-stone-300 bg-white px-2 text-sm"
          >
            <option value="ALL">All</option>
            <option value="DINE_IN">Dine-in</option>
            <option value="TAKEAWAY">Takeaway</option>
            <option value="DELIVERY">Delivery</option>
          </select>
          <Button variant="outline" size="sm" onClick={() => void refresh()} aria-label="Refresh orders now">
            <RefreshCw className="h-4 w-4" aria-hidden /> Refresh
          </Button>
        </div>
      </div>

      <p className="text-xs text-stone-500" aria-live="polite">
        {offline
          ? "Connection problem — retrying every 5 seconds."
          : `Auto-refreshes every ${POLL_MS / 1000}s${lastSync ? ` · last update ${lastSync.toLocaleTimeString()}` : ""}`}
      </p>
      {error ? <Alert tone="error">{error}</Alert> : null}

      {visible.length === 0 ? (
        <EmptyState
          title="No orders here"
          description={filter === "active" ? "New orders will appear automatically." : "Nothing in this view right now."}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((order) => {
            const waited = Math.max(0, Math.floor((now - new Date(order.placedAt).getTime()) / 60_000));
            const finished = order.status === "COMPLETED" || order.status === "CANCELLED";
            const late = !finished && waited >= lateMinutes;
            const warning = !finished && !late && waited >= Math.ceil((lateMinutes * 2) / 3);
            const forward = nextForwardStatus(order.status);
            const canForward = forward && canTransition(role, order.status, forward);
            const canCancel = canTransition(role, order.status, OrderStatus.CANCELLED);
            const busy = pendingIds.has(order.id);
            return (
              <article
                key={order.id}
                aria-labelledby={`kds-${order.id}`}
                className={cn(
                  "flex flex-col rounded-2xl border-2 bg-white p-4 shadow-sm",
                  late
                    ? "border-red-500"
                    : warning
                      ? "border-amber-400"
                      : order.status === "READY"
                        ? "border-emerald-400"
                        : "border-stone-200",
                )}
              >
                <header className="flex items-start justify-between gap-2">
                  <div>
                    <h2 id={`kds-${order.id}`} className="text-lg font-bold text-stone-900">
                      {formatOrderNumber(order.orderNumber)}
                    </h2>
                    <p className="text-sm text-stone-600">
                      {order.type === "DINE_IN" ? `Dine-in${order.table ? ` · ${order.table.label}` : ""}` : humanize(order.type)} ·{" "}
                      {order.contactName}
                    </p>
                  </div>
                  <OrderStatusBadge status={order.status} />
                </header>
                <p
                  className={cn(
                    "mt-2 flex items-center gap-1.5 text-sm font-medium",
                    late ? "text-red-700" : warning ? "text-amber-700" : "text-stone-600",
                  )}
                >
                  {late ? <AlertTriangle className="h-4 w-4" aria-hidden /> : <Clock className="h-4 w-4" aria-hidden />}
                  {waited} min since order{late ? " — priority" : ""}
                  <span className="ml-auto text-xs font-normal text-stone-500">
                    {new Date(order.placedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </p>
                <ul className="mt-3 flex-1 space-y-2 border-t border-stone-100 pt-3">
                  {order.items.map((item) => (
                    <li key={item.id} className="text-sm">
                      <p className="font-semibold text-stone-900">
                        <span className="mr-1.5 inline-block min-w-6 rounded bg-stone-900 px-1 text-center text-white">
                          {item.quantity}
                        </span>
                        {item.nameSnapshot}
                        {item.variantName ? <span className="font-normal text-stone-600"> · {item.variantName}</span> : null}
                      </p>
                      {addOnNames(item.addOns).length ? (
                        <p className="ml-8 text-stone-600">+ {addOnNames(item.addOns).join(", ")}</p>
                      ) : null}
                      {item.notes ? <p className="ml-8 font-medium text-amber-800">Note: {item.notes}</p> : null}
                    </li>
                  ))}
                </ul>
                {order.notes ? (
                  <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-sm text-amber-900">Order note: {order.notes}</p>
                ) : null}
                {!finished ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {canForward && forward ? (
                      <Button
                        size="lg"
                        variant={forward === "READY" ? "success" : "primary"}
                        className="flex-1"
                        disabled={busy}
                        aria-busy={busy || undefined}
                        onClick={() => void move(order, forward)}
                      >
                        {busy ? "Updating…" : FORWARD_LABEL[forward]}
                      </Button>
                    ) : null}
                    {canCancel ? (
                      <ConfirmButton
                        title={`Cancel ${formatOrderNumber(order.orderNumber)}?`}
                        description="The customer will see the order as cancelled. Any pending payment is voided."
                        confirmLabel="Cancel order"
                        size="lg"
                        disabled={busy}
                        onConfirm={() => move(order, OrderStatus.CANCELLED, "Cancelled by kitchen")}
                      >
                        Cancel
                      </ConfirmButton>
                    ) : null}
                  </div>
                ) : null}
                {order.paymentStatus === "UNPAID" && !finished ? (
                  <Badge tone="amber" className="mt-3 self-start">
                    Not yet paid
                  </Badge>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
