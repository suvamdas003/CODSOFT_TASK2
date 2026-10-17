import { CalendarDays, Clock, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/display";
import { MenuItemCard } from "@/features/menu/menu-item-card";
import { minutesToHHMM } from "@/lib/time";
import { getFeaturedItems } from "@/server/repositories/menu-repository";
import { getOpeningHours, getSettings, toPublicSettings } from "@/server/repositories/settings-repository";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function HomePage() {
  const [settings, featured, hours] = await Promise.all([getSettings(), getFeaturedItems(6), getOpeningHours()]);
  const publicSettings = toPublicSettings(settings);

  return (
    <div className="space-y-14">
      <section className="from-brand-700 via-brand-600 overflow-hidden rounded-3xl bg-gradient-to-br to-amber-600 px-6 py-14 text-white shadow-lg sm:px-12">
        <p className="text-brand-100 text-sm font-semibold tracking-widest uppercase">{settings.tagline ?? "Welcome"}</p>
        <h1 className="font-display mt-3 max-w-2xl text-4xl leading-tight font-semibold sm:text-5xl">
          Order ahead, book a table, and track your meal in real time.
        </h1>
        <p className="text-brand-50 mt-4 max-w-xl">
          Browse today&apos;s menu at {settings.name}, choose dine-in or takeaway
          {settings.enabledOrderTypes.includes("DELIVERY") ? " or delivery" : ""}, and follow your order from the kitchen to your table.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/menu" className={buttonVariants({ size: "lg", variant: "secondary" })}>
            <UtensilsCrossed className="h-5 w-5" aria-hidden /> Browse the menu
          </Link>
          <Link
            href="/reservations/new"
            className={buttonVariants({
              size: "lg",
              variant: "outline",
              className: "border-white/40 bg-white/10 text-white hover:bg-white/20",
            })}
          >
            <CalendarDays className="h-5 w-5" aria-hidden /> Book a table
          </Link>
        </div>
        {!settings.acceptingOrders ? (
          <p className="mt-6 inline-block rounded-lg bg-black/20 px-3 py-2 text-sm">
            Online ordering is paused right now — you can still browse and book.
          </p>
        ) : null}
      </section>

      {featured.length ? (
        <section aria-labelledby="featured-heading">
          <div className="mb-5 flex items-end justify-between gap-4">
            <h2 id="featured-heading" className="font-display text-2xl font-semibold text-stone-900">
              Chef&apos;s favourites
            </h2>
            <Link href="/menu" className="text-brand-700 text-sm font-medium hover:underline">
              See full menu →
            </Link>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((item) => (
              <MenuItemCard key={item.id} item={item} settings={publicSettings} />
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="hours-heading" className="grid gap-6 md:grid-cols-2">
        <Card className="p-6">
          <h2 id="hours-heading" className="flex items-center gap-2 text-lg font-semibold text-stone-900">
            <Clock className="text-brand-600 h-5 w-5" aria-hidden /> Opening hours
          </h2>
          <dl className="mt-4 divide-y divide-stone-100 text-sm">
            {hours.map((day) => (
              <div key={day.dayOfWeek} className="flex justify-between py-2">
                <dt className="text-stone-600">{DAY_NAMES[day.dayOfWeek]}</dt>
                <dd className="font-medium text-stone-900">
                  {day.isClosed ? "Closed" : `${minutesToHHMM(day.openMinute)} – ${minutesToHHMM(day.closeMinute)}`}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-stone-500">Times shown in {settings.timezone}.</p>
        </Card>
        <Card className="flex flex-col justify-between p-6">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-stone-900">
              <CalendarDays className="text-brand-600 h-5 w-5" aria-hidden /> Reserve a table
            </h2>
            <p className="mt-3 text-sm text-stone-600">
              Tables for up to {settings.maxPartySize} guests can be booked online, up to {settings.reservationMaxDaysAhead} days ahead.
              Each booking holds your table for {settings.reservationDurationMinutes} minutes.
            </p>
          </div>
          <Link href="/reservations/new" className={buttonVariants({ className: "mt-6 self-start" })}>
            Find a time
          </Link>
        </Card>
      </section>
    </div>
  );
}
