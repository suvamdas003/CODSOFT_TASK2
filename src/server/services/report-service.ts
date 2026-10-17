import { OrderStatus, PaymentStatus, ReservationStatus } from "@/generated/prisma/enums";
import { ADMIN_ROLES, assertRole, type Actor } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { addDaysISO, zonedDateISO, zonedDayRange } from "@/lib/time";
import { getSettings } from "@/server/repositories/settings-repository";
import { ACTIVE_ORDER_STATUSES } from "@/server/services/order-status";

/**
 * All figures are computed from stored records. "Gross sales" is the total of
 * non-cancelled orders placed in the range; "collected" is the sum of payments
 * actually marked PAID (verified online or recorded manually) in the range.
 */

export type DailyPoint = { day: string; orders: number; grossMinor: number };

function eachDay(fromISO: string, toISO: string): string[] {
  const days: string[] = [];
  for (let day = fromISO; day <= toISO && days.length <= 400; day = addDaysISO(day, 1)) days.push(day);
  return days;
}

async function dailySales(fromISO: string, toISO: string, timezone: string): Promise<DailyPoint[]> {
  const start = zonedDayRange(fromISO, timezone).start.toISOString();
  const end = zonedDayRange(toISO, timezone).end.toISOString();
  // placedAt is stored as UTC "timestamp without time zone"; convert explicitly so
  // results do not depend on the database session time zone.
  const rows = await prisma.$queryRaw<{ day: string; orders: number; gross: bigint }[]>`
    SELECT to_char(("placedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day,
           COUNT(*)::int AS orders,
           COALESCE(SUM("totalMinor"), 0)::bigint AS gross
      FROM "orders"
     WHERE "placedAt" >= (${start}::timestamptz AT TIME ZONE 'UTC')
       AND "placedAt" <  (${end}::timestamptz AT TIME ZONE 'UTC')
       AND "status" <> 'CANCELLED'
     GROUP BY 1
     ORDER BY 1`;
  const byDay = new Map(rows.map((row) => [row.day, row]));
  return eachDay(fromISO, toISO).map((day) => {
    const row = byDay.get(day);
    return { day, orders: row ? Number(row.orders) : 0, grossMinor: row ? Number(row.gross) : 0 };
  });
}

export async function getDashboardSummary(actor: Actor, now = new Date()) {
  assertRole(actor, ADMIN_ROLES);
  const settings = await getSettings();
  const today = zonedDateISO(now, settings.timezone);
  const { start, end } = zonedDayRange(today, settings.timezone);
  const placedToday = { placedAt: { gte: start, lt: end } };

  const [ordersToday, grossToday, collectedToday, activeOrders, unpaidActive, reservationsToday, recentOrders, series] = await Promise.all([
    prisma.order.count({ where: placedToday }),
    prisma.order.aggregate({ where: { ...placedToday, status: { not: OrderStatus.CANCELLED } }, _sum: { totalMinor: true } }),
    prisma.payment.aggregate({ where: { status: PaymentStatus.PAID, paidAt: { gte: start, lt: end } }, _sum: { amountMinor: true } }),
    prisma.order.count({ where: { status: { in: [...ACTIVE_ORDER_STATUSES] } } }),
    prisma.order.count({ where: { status: { in: [...ACTIVE_ORDER_STATUSES] }, paymentStatus: "UNPAID" } }),
    prisma.reservation.aggregate({
      where: {
        startsAt: { gte: start, lt: end },
        status: { in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED, ReservationStatus.SEATED, ReservationStatus.COMPLETED] },
      },
      _count: { _all: true },
      _sum: { partySize: true },
    }),
    prisma.order.findMany({
      orderBy: { placedAt: "desc" },
      take: 6,
      select: {
        id: true,
        orderNumber: true,
        contactName: true,
        status: true,
        paymentStatus: true,
        totalMinor: true,
        currency: true,
        placedAt: true,
      },
    }),
    dailySales(addDaysISO(today, -13), today, settings.timezone),
  ]);

  return {
    today,
    currency: settings.currency,
    ordersToday,
    grossTodayMinor: grossToday._sum.totalMinor ?? 0,
    collectedTodayMinor: collectedToday._sum.amountMinor ?? 0,
    activeOrders,
    unpaidActive,
    reservationsToday: reservationsToday._count._all,
    coversToday: reservationsToday._sum.partySize ?? 0,
    recentOrders,
    series,
  };
}

export async function getReport(actor: Actor, range: { from: string; to: string }) {
  assertRole(actor, ADMIN_ROLES);
  if (range.from > range.to) throw new ValidationError("The start date must be before the end date.");
  if (eachDay(range.from, range.to).length > 366) throw new ValidationError("Choose a range of at most 366 days.");

  const settings = await getSettings();
  const start = zonedDayRange(range.from, settings.timezone).start;
  const end = zonedDayRange(range.to, settings.timezone).end;
  const placed = { placedAt: { gte: start, lt: end } };
  const notCancelled = { ...placed, status: { not: OrderStatus.CANCELLED } };

  const [byStatus, byType, collected, collectedByProvider, topItems, reservationsByStatus, covers, series] = await Promise.all([
    prisma.order.groupBy({ by: ["status"], where: placed, _count: { _all: true } }),
    prisma.order.groupBy({ by: ["type"], where: notCancelled, _count: { _all: true }, _sum: { totalMinor: true } }),
    prisma.payment.aggregate({
      where: { status: PaymentStatus.PAID, paidAt: { gte: start, lt: end } },
      _sum: { amountMinor: true },
      _count: { _all: true },
    }),
    prisma.payment.groupBy({
      by: ["provider"],
      where: { status: PaymentStatus.PAID, paidAt: { gte: start, lt: end } },
      _sum: { amountMinor: true },
      _count: { _all: true },
    }),
    prisma.orderItem.groupBy({
      by: ["nameSnapshot"],
      where: { order: notCancelled },
      _sum: { quantity: true, lineTotalMinor: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 10,
    }),
    prisma.reservation.groupBy({ by: ["status"], where: { startsAt: { gte: start, lt: end } }, _count: { _all: true } }),
    prisma.reservation.aggregate({
      where: { startsAt: { gte: start, lt: end }, status: { in: [ReservationStatus.SEATED, ReservationStatus.COMPLETED] } },
      _sum: { partySize: true },
    }),
    dailySales(range.from, range.to, settings.timezone),
  ]);

  const grossMinor = byType.reduce((sum, row) => sum + (row._sum.totalMinor ?? 0), 0);
  const orderCount = byType.reduce((sum, row) => sum + row._count._all, 0);

  return {
    range,
    currency: settings.currency,
    grossMinor,
    orderCount,
    averageOrderMinor: orderCount ? Math.round(grossMinor / orderCount) : 0,
    collectedMinor: collected._sum.amountMinor ?? 0,
    collectedCount: collected._count._all,
    collectedByProvider: collectedByProvider.map((row) => ({
      provider: row.provider,
      amountMinor: row._sum.amountMinor ?? 0,
      count: row._count._all,
    })),
    byStatus: byStatus.map((row) => ({ status: row.status, count: row._count._all })),
    byType: byType.map((row) => ({ type: row.type, count: row._count._all, grossMinor: row._sum.totalMinor ?? 0 })),
    topItems: topItems.map((row) => ({
      name: row.nameSnapshot,
      quantity: row._sum.quantity ?? 0,
      revenueMinor: row._sum.lineTotalMinor ?? 0,
    })),
    reservationsByStatus: reservationsByStatus.map((row) => ({ status: row.status, count: row._count._all })),
    seatedCovers: covers._sum.partySize ?? 0,
    series,
  };
}

export async function listAuditEvents(actor: Actor, page: number, pageSize = 30) {
  assertRole(actor, ADMIN_ROLES);
  const [events, total] = await Promise.all([
    prisma.auditEvent.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { actor: { select: { name: true, email: true } } },
    }),
    prisma.auditEvent.count(),
  ]);
  return { events, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}
