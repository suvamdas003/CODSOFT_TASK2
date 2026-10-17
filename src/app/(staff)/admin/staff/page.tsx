import type { Metadata } from "next";
import { z } from "zod";
import { Role } from "@/generated/prisma/enums";
import { buttonVariants } from "@/components/ui/button";
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Pagination, Table, Td, Th } from "@/components/ui/display";
import { Input, Select } from "@/components/ui/form-controls";
import { StaffCreateForm, UserRowControls } from "@/features/admin/forms";
import { ADMIN_ROLES } from "@/lib/auth/permissions";
import { requireRole } from "@/lib/auth/session";
import { firstParam, formatDate, humanize } from "@/lib/utils";
import { getSettings } from "@/server/repositories/settings-repository";
import { listUsers } from "@/server/services/staff-service";

export const metadata: Metadata = { title: "Staff & users" };

const filterSchema = z.object({
  role: z.enum(Role).optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
  page: z.coerce.number().int().min(1).catch(1),
});

export default async function StaffPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole(ADMIN_ROLES, "/admin/staff");
  const raw = await searchParams;
  const filters = filterSchema.parse({
    role: firstParam(raw.role) || undefined,
    q: firstParam(raw.q) || undefined,
    page: firstParam(raw.page),
  });
  const [{ users, total, pageCount }, settings] = await Promise.all([listUsers(user, filters), getSettings()]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff & users"
        description="Create staff accounts, change roles and deactivate access. Customers register themselves."
      />
      <Card>
        <CardHeader title="Create a staff account" description="Give the person their temporary password through a secure channel." />
        <CardBody>
          <StaffCreateForm />
        </CardBody>
      </Card>
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-stone-200 bg-white p-4" role="search">
        <label className="min-w-48 flex-1">
          <span className="mb-1 block text-xs font-medium text-stone-600">Search</span>
          <Input name="q" defaultValue={filters.q} placeholder="Name or email" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-stone-600">Role</span>
          <Select name="role" defaultValue={filters.role ?? ""}>
            <option value="">All roles</option>
            {Object.values(Role).map((role) => (
              <option key={role} value={role}>
                {humanize(role)}
              </option>
            ))}
          </Select>
        </label>
        <button type="submit" className={buttonVariants({ variant: "secondary" })}>
          Filter
        </button>
      </form>
      {users.length === 0 ? (
        <EmptyState title="No users found" />
      ) : (
        <>
          <p className="text-sm text-stone-500">{total} account(s)</p>
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th>Joined</Th>
                <Th className="text-right">Manage</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {users.map((account) => (
                <tr key={account.id}>
                  <Td>
                    <span className="font-medium">{account.name}</span>
                    <p className="text-xs text-stone-500">{account.email}</p>
                  </Td>
                  <Td>
                    <Badge tone={account.role === "ADMIN" ? "purple" : account.role === "KITCHEN_STAFF" ? "blue" : "neutral"}>
                      {humanize(account.role)}
                    </Badge>
                  </Td>
                  <Td>{account.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="red">Deactivated</Badge>}</Td>
                  <Td>{formatDate(account.createdAt, settings.timezone, settings.locale)}</Td>
                  <Td className="text-right">
                    <UserRowControls userId={account.id} role={account.role} isActive={account.isActive} isSelf={account.id === user.id} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={filters.page} pageCount={pageCount} basePath="/admin/staff" params={{ q: filters.q, role: filters.role }} />
        </>
      )}
    </div>
  );
}
