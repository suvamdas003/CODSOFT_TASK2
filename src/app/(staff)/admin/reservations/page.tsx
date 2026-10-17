import type { Metadata } from "next";
import Link from "next/link";
import { ReservationStatus } from "@/generated/prisma/enums";
import { ReservationStatusBadge } from "@/components/shared/status-badges";
import { buttonVariants } from "@/components/ui/button";
import { Alert, EmptyState, PageHeader, Pagination, Table, Td, Th } from "@/components/ui/display";
import { Input, Select } from "@/components/ui/form-controls";
import { ReservationStatusButtons } from "@/features/reservations/reservation-buttons";
import { ADMIN_ROLES } from "@/lib/auth/permissions";
import { requireRole } from "@/lib/auth/session";
import { addDaysISO, zonedDateISO } from "@/lib/time";
import { cn, firstParam, formatDateTime, formatTime, humanize } from "@/lib/utils";
import { reservationListFilterSchema } from "@/lib/validation/reservation";
import { getSettings } from "@/server/repositories/settings-repository";
import { listReservationsForAdmin, RESERVATION_FLOW } from "@/server/services/reservation-service";

export const metadata: Metadata = { title: "Reservations" };

export default async function AdminReservationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole(ADMIN_ROLES, "/admin/reservations");
  const raw = await searchParams;
  const settings = await getSettings();
  const today = zonedDateISO(new Date(), settings.timezone);
  const showAll = firstParam(raw.all) === "1";
  const filters = reservationListFilterSchema.parse({
    date: showAll ? undefined : firstParam(raw.date) || today,
    status: firstParam(raw.status) || undefined,
    q: firstParam(raw.q) || undefined,
    page: firstParam(raw.page),
  });
  const { reservations, total, pageCount } = await listReservationsForAdmin(user, filters);
  const covers = reservations
    .filter((reservation) => reservation.status !== "CANCELLED" && reservation.status !== "NO_SHOW")
    .reduce((sum, r) => sum + r.partySize, 0);
  const dayLink = (date: string) => `/admin/reservations?date=${date}`;

  return (
    <div>
      <PageHeader
        title="Reservations"
        description={
          filters.date ? `${total} booking(s) on ${filters.date} · ${covers} guests on this page` : `${total} booking(s) across all dates`
        }
        actions={
          <Link href="/reservations/new" className={buttonVariants()}>
            New booking
          </Link>
        }
      />
      {firstParam(raw.created) ? (
        <Alert tone="success" className="mb-4">
          Booking {firstParam(raw.created)} created.
        </Alert>
      ) : null}
      {firstParam(raw.updated) ? (
        <Alert tone="success" className="mb-4">
          Booking updated.
        </Alert>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-2">
        {[-1, 0, 1, 2, 3, 4, 5, 6].map((offset) => {
          const date = addDaysISO(today, offset);
          const active = filters.date === date;
          return (
            <Link
              key={date}
              href={dayLink(date)}
              className={cn(
                "rounded-full border px-3 py-1 text-sm",
                active ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50",
              )}
            >
              {offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : offset === -1 ? "Yesterday" : date.slice(5)}
            </Link>
          );
        })}
        <Link
          href="/admin/reservations?all=1"
          className={cn(
            "rounded-full border px-3 py-1 text-sm",
            showAll ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white text-stone-700",
          )}
        >
          All dates
        </Link>
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-stone-200 bg-white p-4" role="search">
        {showAll ? <input type="hidden" name="all" value="1" /> : null}
        {!showAll ? (
          <label>
            <span className="mb-1 block text-xs font-medium text-stone-600">Date</span>
            <Input type="date" name="date" defaultValue={filters.date} />
          </label>
        ) : null}
        <label>
          <span className="mb-1 block text-xs font-medium text-stone-600">Status</span>
          <Select name="status" defaultValue={filters.status ?? ""}>
            <option value="">Any</option>
            {Object.values(ReservationStatus).map((status) => (
              <option key={status} value={status}>
                {humanize(status)}
              </option>
            ))}
          </Select>
        </label>
        <label className="min-w-48 flex-1">
          <span className="mb-1 block text-xs font-medium text-stone-600">Search</span>
          <Input name="q" defaultValue={filters.q} placeholder="Reference, name or phone" />
        </label>
        <button type="submit" className={buttonVariants({ variant: "secondary" })}>
          Filter
        </button>
      </form>

      {reservations.length === 0 ? (
        <EmptyState title="No reservations" description="No bookings match these filters." />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Time</Th>
                <Th>Guest</Th>
                <Th>Party</Th>
                <Th>Table</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {reservations.map((reservation) => (
                <tr key={reservation.id}>
                  <Td>
                    <span className="font-medium">
                      {filters.date
                        ? formatTime(reservation.startsAt, settings.timezone, settings.locale)
                        : formatDateTime(reservation.startsAt, settings.timezone, settings.locale)}
                    </span>
                    <p className="text-xs text-stone-500">until {formatTime(reservation.endsAt, settings.timezone, settings.locale)}</p>
                  </Td>
                  <Td>
                    {reservation.contactName}
                    <p className="text-xs text-stone-500">
                      {reservation.contactPhone} · Ref {reservation.code}
                    </p>
                    {reservation.notes ? <p className="text-xs text-stone-500 italic">“{reservation.notes}”</p> : null}
                  </Td>
                  <Td>{reservation.partySize}</Td>
                  <Td>
                    {reservation.table.label} <span className="text-xs text-stone-500">({reservation.table.capacity})</span>
                  </Td>
                  <Td>
                    <ReservationStatusBadge status={reservation.status} />
                  </Td>
                  <Td className="text-right">
                    <div className="flex flex-col items-end gap-2">
                      <ReservationStatusButtons
                        reservationId={reservation.id}
                        status={reservation.status}
                        transitions={[...RESERVATION_FLOW[reservation.status]]}
                      />
                      {reservation.status === "PENDING" || reservation.status === "CONFIRMED" ? (
                        <Link href={`/reservations/${reservation.id}`} className="text-brand-700 text-xs font-medium hover:underline">
                          Change time / size
                        </Link>
                      ) : null}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination
            page={filters.page}
            pageCount={pageCount}
            basePath="/admin/reservations"
            params={{ date: showAll ? undefined : filters.date, all: showAll ? "1" : undefined, status: filters.status, q: filters.q }}
          />
        </>
      )}
    </div>
  );
}
