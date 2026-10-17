import type { Metadata } from "next";
import { buttonVariants } from "@/components/ui/button";
import { Alert, Card, CardBody, CardHeader, PageHeader, StatCard, Table, Td, Th } from "@/components/ui/display";
import { Input } from "@/components/ui/form-controls";
import { SalesChart, TopItemsChart } from "@/features/admin/charts";
import { ADMIN_ROLES } from "@/lib/auth/permissions";
import { requireRole } from "@/lib/auth/session";
import { isAppError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { addDaysISO, isValidISODate, zonedDateISO } from "@/lib/time";
import { firstParam, humanize } from "@/lib/utils";
import { getSettings } from "@/server/repositories/settings-repository";
import { getReport } from "@/server/services/report-service";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole(ADMIN_ROLES, "/admin/reports");
  const raw = await searchParams;
  const settings = await getSettings();
  const today = zonedDateISO(new Date(), settings.timezone);
  const fromParam = firstParam(raw.from);
  const toParam = firstParam(raw.to);
  const from = fromParam && isValidISODate(fromParam) ? fromParam : addDaysISO(today, -29);
  const to = toParam && isValidISODate(toParam) ? toParam : today;

  let report: Awaited<ReturnType<typeof getReport>> | null = null;
  let error: string | null = null;
  try {
    report = await getReport(user, { from, to });
  } catch (caught) {
    if (!isAppError(caught)) throw caught;
    error = caught.message;
  }
  const money = (minor: number) => formatMoney(minor, settings.currency, settings.locale);

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" description="Order volumes, sales, popular items and reservations from stored records." />
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-stone-200 bg-white p-4">
        <label>
          <span className="mb-1 block text-xs font-medium text-stone-600">From</span>
          <Input type="date" name="from" defaultValue={from} max={today} />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-stone-600">To</span>
          <Input type="date" name="to" defaultValue={to} />
        </label>
        <button type="submit" className={buttonVariants({ variant: "secondary" })}>
          Update
        </button>
      </form>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {report ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Orders (excl. cancelled)" value={report.orderCount} />
            <StatCard label="Gross sales" value={money(report.grossMinor)} hint="Totals of non-cancelled orders" />
            <StatCard label="Average order" value={money(report.averageOrderMinor)} />
            <StatCard
              label="Payments collected"
              value={money(report.collectedMinor)}
              hint={`${report.collectedCount} payment(s) marked paid`}
            />
          </div>
          <Card>
            <CardHeader title="Daily gross sales" />
            <CardBody>
              <SalesChart data={report.series} currency={report.currency} locale={settings.locale} />
            </CardBody>
          </Card>
          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader title="Most popular items" description="By quantity sold (non-cancelled orders)." />
              <CardBody>
                <TopItemsChart data={report.topItems.map((item) => ({ name: item.name, quantity: item.quantity }))} />
                {report.topItems.length ? (
                  <Table className="mt-4">
                    <thead>
                      <tr>
                        <Th>Item</Th>
                        <Th className="text-right">Qty</Th>
                        <Th className="text-right">Revenue</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {report.topItems.map((item) => (
                        <tr key={item.name}>
                          <Td>{item.name}</Td>
                          <Td className="text-right">{item.quantity}</Td>
                          <Td className="text-right">{money(item.revenueMinor)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                ) : null}
              </CardBody>
            </Card>
            <div className="space-y-6">
              <Card>
                <CardHeader title="Orders by status" />
                <CardBody>
                  <BreakdownList rows={report.byStatus.map((row) => ({ label: humanize(row.status), value: String(row.count) }))} />
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Orders by type" />
                <CardBody>
                  <BreakdownList
                    rows={report.byType.map((row) => ({ label: humanize(row.type), value: `${row.count} · ${money(row.grossMinor)}` }))}
                  />
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Payments by provider" />
                <CardBody>
                  <BreakdownList
                    rows={report.collectedByProvider.map((row) => ({
                      label: row.provider === "MANUAL" ? "Manual (recorded by staff)" : "Online (Stripe, verified)",
                      value: `${row.count} · ${money(row.amountMinor)}`,
                    }))}
                  />
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Reservations" description={`${report.seatedCovers} guests seated or completed`} />
                <CardBody>
                  <BreakdownList
                    rows={report.reservationsByStatus.map((row) => ({ label: humanize(row.status), value: String(row.count) }))}
                  />
                </CardBody>
              </Card>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function BreakdownList({ rows }: { rows: { label: string; value: string }[] }) {
  if (!rows.length) return <p className="text-sm text-stone-500">No data for this period.</p>;
  return (
    <dl className="divide-y divide-stone-100 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="flex justify-between py-2">
          <dt className="text-stone-600">{row.label}</dt>
          <dd className="font-medium text-stone-900">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
