import type { Metadata } from "next";
import Link from "next/link";
import { MenuImage } from "@/components/shared/menu-image";
import { buttonVariants } from "@/components/ui/button";
import { Badge, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui/display";
import { Input, Select } from "@/components/ui/form-controls";
import { ItemRowActions } from "@/features/admin/menu-admin";
import { ADMIN_ROLES } from "@/lib/auth/permissions";
import { requireRole } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { firstParam } from "@/lib/utils";
import { getSettings } from "@/server/repositories/settings-repository";
import { listCategoriesForAdmin, listMenuForAdmin } from "@/server/services/menu-service";

export const metadata: Metadata = { title: "Menu items" };

export default async function AdminMenuPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole(ADMIN_ROLES, "/admin/menu");
  const raw = await searchParams;
  const q = firstParam(raw.q)?.trim().slice(0, 60) || undefined;
  const categoryId = firstParam(raw.categoryId)?.slice(0, 64) || undefined;
  const archived = firstParam(raw.archived) === "1";
  const [items, categories, settings] = await Promise.all([
    listMenuForAdmin({ q, categoryId, archived }),
    listCategoriesForAdmin(),
    getSettings(),
  ]);

  return (
    <div>
      <PageHeader
        title="Menu items"
        description="Prices, availability, options and visibility."
        actions={
          <Link href="/admin/menu/new" className={buttonVariants()}>
            New item
          </Link>
        }
      />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-stone-200 bg-white p-4" role="search">
        <label className="min-w-48 flex-1">
          <span className="mb-1 block text-xs font-medium text-stone-600">Search</span>
          <Input name="q" defaultValue={q} placeholder="Item name" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-stone-600">Category</span>
          <Select name="categoryId" defaultValue={categoryId ?? ""}>
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-stone-600">Show</span>
          <Select name="archived" defaultValue={archived ? "1" : ""}>
            <option value="">Current items</option>
            <option value="1">Archived items</option>
          </Select>
        </label>
        <button type="submit" className={buttonVariants({ variant: "secondary" })}>
          Filter
        </button>
      </form>

      {items.length === 0 ? (
        <EmptyState
          title={archived ? "No archived items" : "No menu items found"}
          action={
            !archived ? (
              <Link href="/admin/menu/new" className={buttonVariants()}>
                Create the first item
              </Link>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Item</Th>
              <Th>Category</Th>
              <Th className="text-right">Price</Th>
              <Th>Status</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {items.map((item) => (
              <tr key={item.id}>
                <Td>
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-stone-100">
                      <MenuImage src={item.imageUrl} alt="" />
                    </div>
                    <div>
                      <Link href={`/admin/menu/${item.id}`} className="text-brand-700 font-medium hover:underline">
                        {item.name}
                      </Link>
                      <p className="text-xs text-stone-500">
                        {item._count.variants} option(s) · {item._count.addOns} extra(s)
                      </p>
                    </div>
                  </div>
                </Td>
                <Td>{item.category.name}</Td>
                <Td className="text-right">{formatMoney(item.priceMinor, settings.currency, settings.locale)}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {item.archivedAt ? <Badge>Archived</Badge> : null}
                    {!item.archivedAt && !item.isPublished ? <Badge tone="neutral">Hidden</Badge> : null}
                    {!item.archivedAt && item.isPublished ? <Badge tone="green">Published</Badge> : null}
                    {!item.isAvailable && !item.archivedAt ? <Badge tone="amber">Sold out</Badge> : null}
                    {item.isFeatured ? <Badge tone="brand">Featured</Badge> : null}
                  </div>
                </Td>
                <Td className="text-right">
                  <ItemRowActions id={item.id} name={item.name} isAvailable={item.isAvailable} archived={Boolean(item.archivedAt)} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
