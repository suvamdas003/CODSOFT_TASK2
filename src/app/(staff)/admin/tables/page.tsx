import type { Metadata } from "next";
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/display";
import { DeleteTableButton, TableForm } from "@/features/admin/forms";
import { ADMIN_ROLES } from "@/lib/auth/permissions";
import { requireRole } from "@/lib/auth/session";
import { listTables } from "@/server/services/table-service";

export const metadata: Metadata = { title: "Tables" };

export default async function TablesPage() {
  await requireRole(ADMIN_ROLES, "/admin/tables");
  const tables = await listTables();
  const activeSeats = tables.filter((table) => table.isActive).reduce((sum, table) => sum + table.capacity, 0);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Tables"
        description={`${tables.filter((table) => table.isActive).length} active table(s), ${activeSeats} seats. Inactive tables are not offered for bookings.`}
      />
      <Card>
        <CardHeader title="Add a table" />
        <CardBody>
          <TableForm />
        </CardBody>
      </Card>
      {tables.length === 0 ? (
        <EmptyState title="No tables yet" description="Add tables to start accepting reservations." />
      ) : (
        <Card>
          <CardHeader title="All tables" />
          <ul className="divide-y divide-stone-100">
            {tables.map((table) => (
              <li key={table.id} className="space-y-2 px-5 py-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="font-semibold">{table.label}</span>
                    {table.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}
                    <span className="text-stone-500">{table._count.reservations} upcoming booking(s)</span>
                  </span>
                  <DeleteTableButton id={table.id} label={table.label} />
                </div>
                <TableForm table={table} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
