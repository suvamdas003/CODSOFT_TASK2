import type { Metadata } from "next";
import Link from "next/link";
import { ReservationStatusBadge } from "@/components/shared/status-badges";
import { buttonVariants } from "@/components/ui/button";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/display";
import { CancelReservationButton } from "@/features/reservations/reservation-buttons";
import { getCurrentUser } from "@/lib/auth/session";
import { firstParam, formatDateTime } from "@/lib/utils";
import { getSettings } from "@/server/repositories/settings-repository";
import { listReservationsForCustomer } from "@/server/services/reservation-service";

export const metadata: Metadata = { title: "Reservations" };

export default async function ReservationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const [user, settings] = await Promise.all([getCurrentUser(), getSettings()]);
  const reservations = user && user.role === "CUSTOMER" ? await listReservationsForCustomer(user) : [];
  const now = new Date();
  const upcoming = reservations.filter(
    (reservation) => reservation.endsAt > now && ["PENDING", "CONFIRMED", "SEATED"].includes(reservation.status),
  );
  const past = reservations.filter((reservation) => !upcoming.includes(reservation));
  const created = firstParam(query.created);

  return (
    <div>
      <PageHeader
        title="Reservations"
        description={`Book up to ${settings.reservationMaxDaysAhead} days ahead for parties of up to ${settings.maxPartySize}.`}
        actions={
          <Link href="/reservations/new" className={buttonVariants()}>
            Book a table
          </Link>
        }
      />
      {created ? (
        <Alert tone="success" className="mb-6" title="Reservation saved">
          Your reference is <strong>{created}</strong>.{" "}
          {settings.autoConfirmReservations ? "Your table is confirmed." : "The restaurant will confirm it shortly."}
        </Alert>
      ) : null}
      {firstParam(query.updated) ? (
        <Alert tone="success" className="mb-6">
          Reservation updated.
        </Alert>
      ) : null}

      {!user ? (
        <Alert tone="info" title="Sign in to book and manage reservations">
          <Link href="/login?next=/reservations" className="font-medium underline">
            Sign in
          </Link>{" "}
          or{" "}
          <Link href="/register?next=/reservations" className="font-medium underline">
            create an account
          </Link>
          .
        </Alert>
      ) : user.role !== "CUSTOMER" ? (
        <Alert tone="info">
          Staff accounts manage bookings from the{" "}
          <Link href="/admin/reservations" className="font-medium underline">
            admin reservations page
          </Link>
          .
        </Alert>
      ) : reservations.length === 0 ? (
        <EmptyState title="No reservations yet" description="Book a table and it will appear here." />
      ) : (
        <div className="space-y-8">
          <ReservationGroup title="Upcoming" items={upcoming} settings={settings} actionable />
          <ReservationGroup title="Past & cancelled" items={past} settings={settings} />
        </div>
      )}
    </div>
  );
}

function ReservationGroup({
  title,
  items,
  settings,
  actionable,
}: {
  title: string;
  items: Awaited<ReturnType<typeof listReservationsForCustomer>>;
  settings: { timezone: string; locale: string };
  actionable?: boolean;
}) {
  if (!items.length) return null;
  const now = new Date();
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-stone-900">{title}</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((reservation) => {
          const changeable =
            actionable && (reservation.status === "PENDING" || reservation.status === "CONFIRMED") && reservation.startsAt > now;
          return (
            <Card key={reservation.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-stone-900">{formatDateTime(reservation.startsAt, settings.timezone, settings.locale)}</p>
                  <p className="text-sm text-stone-600">
                    {reservation.partySize} guests · Table {reservation.table.label} · Ref {reservation.code}
                  </p>
                  {reservation.notes ? <p className="mt-1 text-sm text-stone-500 italic">“{reservation.notes}”</p> : null}
                </div>
                <ReservationStatusBadge status={reservation.status} />
              </div>
              {changeable ? (
                <div className="mt-3 flex gap-2">
                  <Link href={`/reservations/${reservation.id}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                    Change
                  </Link>
                  <CancelReservationButton reservationId={reservation.id} />
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>
    </section>
  );
}
