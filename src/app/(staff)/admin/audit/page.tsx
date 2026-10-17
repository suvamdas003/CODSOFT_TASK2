import type { Metadata } from "next";
import { EmptyState, PageHeader, Pagination, Table, Td, Th } from "@/components/ui/display";
import { ADMIN_ROLES } from "@/lib/auth/permissions";
import { requireRole } from "@/lib/auth/session";
import { firstParam, formatDateTime } from "@/lib/utils";
import { pageSchema } from "@/lib/validation/common";
import { getSettings } from "@/server/repositories/settings-repository";
import { listAuditEvents } from "@/server/services/report-service";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole(ADMIN_ROLES, "/admin/audit");
  const page = pageSchema.parse(firstParam((await searchParams).page));
  const [{ events, pageCount }, settings] = await Promise.all([listAuditEvents(user, page), getSettings()]);
  return (
    <div>
      <PageHeader title="Audit log" description="Significant administrative operations, newest first." />
      {events.length === 0 ? (
        <EmptyState title="No audit events yet" />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>Action</Th>
                <Th>Details</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {events.map((event) => (
                <tr key={event.id}>
                  <Td className="whitespace-nowrap">{formatDateTime(event.createdAt, settings.timezone, settings.locale)}</Td>
                  <Td>{event.actor ? `${event.actor.name} (${event.actor.email})` : "System"}</Td>
                  <Td>
                    <code className="rounded bg-stone-100 px-1.5 py-0.5 text-xs">{event.action}</code>
                  </Td>
                  <Td>{event.summary}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} pageCount={pageCount} basePath="/admin/audit" params={{}} />
        </>
      )}
    </div>
  );
}
