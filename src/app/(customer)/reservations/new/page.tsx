import type { Metadata } from "next";
import { Card, CardBody, PageHeader } from "@/components/ui/display";
import { ReservationForm } from "@/features/reservations/reservation-form";
import { requireRole } from "@/lib/auth/session";
import { addDaysISO, zonedDateISO } from "@/lib/time";
import { getSettings } from "@/server/repositories/settings-repository";

export const metadata: Metadata = { title: "Book a table" };

export default async function NewReservationPage() {
  const user = await requireRole(["CUSTOMER", "ADMIN"], "/reservations/new");
  const settings = await getSettings();
  const today = zonedDateISO(new Date(), settings.timezone);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Book a table" description="Pick a date and party size to see available times." />
      <Card>
        <CardBody className="py-6">
          <ReservationForm
            mode="create"
            minDate={today}
            maxDate={addDaysISO(today, settings.reservationMaxDaysAhead)}
            maxPartySize={settings.maxPartySize}
            timezone={settings.timezone}
            durationMinutes={settings.reservationDurationMinutes}
            successPath={user.role === "ADMIN" ? "/admin/reservations" : "/reservations"}
            defaultContact={user.role === "CUSTOMER" ? { name: user.name } : undefined}
          />
        </CardBody>
      </Card>
    </div>
  );
}
