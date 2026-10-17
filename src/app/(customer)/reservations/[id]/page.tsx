import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReservationStatusBadge } from "@/components/shared/status-badges";
import { Alert, Card, CardBody, PageHeader } from "@/components/ui/display";
import { ReservationForm } from "@/features/reservations/reservation-form";
import { requireRole } from "@/lib/auth/session";
import { NotFoundError } from "@/lib/errors";
import { addDaysISO, zonedDateISO, zonedMinuteOfDay } from "@/lib/time";
import { formatDateTime } from "@/lib/utils";
import { getSettings } from "@/server/repositories/settings-repository";
import { getReservationForActor } from "@/server/services/reservation-service";

export const metadata: Metadata = { title: "Change reservation" };

export default async function EditReservationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireRole(["CUSTOMER", "ADMIN"], `/reservations/${id}`);
  let reservation: Awaited<ReturnType<typeof getReservationForActor>>;
  try {
    reservation = await getReservationForActor(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const settings = await getSettings();
  const today = zonedDateISO(new Date(), settings.timezone);
  const editable =
    (reservation.status === "PENDING" || reservation.status === "CONFIRMED") &&
    (user.role === "ADMIN" || reservation.startsAt > new Date());
  const backHref = user.role === "ADMIN" ? "/admin/reservations" : "/reservations";

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={`Reservation ${reservation.code}`}
        description={`${formatDateTime(reservation.startsAt, settings.timezone, settings.locale)} · ${reservation.partySize} guests · Table ${reservation.table.label}`}
        actions={<ReservationStatusBadge status={reservation.status} />}
      />
      {editable ? (
        <Card>
          <CardBody className="py-6">
            <ReservationForm
              mode="modify"
              minDate={today}
              maxDate={addDaysISO(today, settings.reservationMaxDaysAhead)}
              maxPartySize={settings.maxPartySize}
              timezone={settings.timezone}
              durationMinutes={settings.reservationDurationMinutes}
              successPath={backHref}
              initial={{
                reservationId: reservation.id,
                date: zonedDateISO(reservation.startsAt, settings.timezone),
                partySize: reservation.partySize,
                startMinute: zonedMinuteOfDay(reservation.startsAt, settings.timezone),
                contactName: reservation.contactName,
                contactPhone: reservation.contactPhone,
                notes: reservation.notes ?? "",
              }}
            />
          </CardBody>
        </Card>
      ) : (
        <Alert tone="info">This reservation can no longer be changed online.</Alert>
      )}
      <Link href={backHref} className="text-brand-700 mt-4 inline-block text-sm font-medium hover:underline">
        ← Back to reservations
      </Link>
    </div>
  );
}
