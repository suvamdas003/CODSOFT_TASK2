import type { Metadata } from "next";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/display";
import { OpeningHoursForm, SettingsForm } from "@/features/admin/forms";
import { ADMIN_ROLES } from "@/lib/auth/permissions";
import { requireRole } from "@/lib/auth/session";
import { minorToMajorString } from "@/lib/money";
import { minutesToHHMM } from "@/lib/time";
import { getOnlinePaymentProvider } from "@/server/payments";
import { getOpeningHours, getSettings } from "@/server/repositories/settings-repository";

export const metadata: Metadata = { title: "Settings" };

const bpsToPercent = (bps: number) => (bps / 100).toFixed(2).replace(/\.?0+$/, "");

export default async function SettingsPage() {
  await requireRole(ADMIN_ROLES, "/admin/settings");
  const [settings, hours] = await Promise.all([getSettings(), getOpeningHours()]);

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Restaurant settings"
        description="Changes to tax, charges and fees apply to new orders only. Existing orders keep their recorded amounts."
      />
      <Card>
        <CardHeader title="General" />
        <CardBody className="py-6">
          <SettingsForm
            onlinePaymentsConfigured={Boolean(getOnlinePaymentProvider())}
            values={{
              name: settings.name,
              tagline: settings.tagline ?? "",
              phone: settings.phone ?? "",
              email: settings.email ?? "",
              address: settings.address ?? "",
              currency: settings.currency,
              locale: settings.locale,
              timezone: settings.timezone,
              taxRate: bpsToPercent(settings.taxRateBps),
              serviceCharge: bpsToPercent(settings.serviceChargeBps),
              deliveryFee: minorToMajorString(settings.deliveryFeeMinor, settings.currency),
              enabledOrderTypes: settings.enabledOrderTypes,
              enabledPaymentMethods: settings.enabledPaymentMethods,
              acceptingOrders: settings.acceptingOrders,
              customerCancelWindowMinutes: settings.customerCancelWindowMinutes,
              reservationDurationMinutes: settings.reservationDurationMinutes,
              reservationSlotMinutes: settings.reservationSlotMinutes,
              reservationLeadMinutes: settings.reservationLeadMinutes,
              reservationMaxDaysAhead: settings.reservationMaxDaysAhead,
              maxPartySize: settings.maxPartySize,
              autoConfirmReservations: settings.autoConfirmReservations,
              kitchenLateMinutes: settings.kitchenLateMinutes,
            }}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Opening hours" description={`In ${settings.timezone}. Used for reservation slots.`} />
        <CardBody>
          <OpeningHoursForm
            days={hours.map((day) => ({
              dayOfWeek: day.dayOfWeek,
              isClosed: day.isClosed,
              open: minutesToHHMM(day.isClosed ? 11 * 60 : day.openMinute),
              close: minutesToHHMM(day.isClosed ? 22 * 60 : day.closeMinute),
            }))}
          />
        </CardBody>
      </Card>
    </div>
  );
}
