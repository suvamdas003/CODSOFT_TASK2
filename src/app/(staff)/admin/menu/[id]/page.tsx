import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Alert, Card, CardBody, CardHeader, PageHeader } from "@/components/ui/display";
import { MenuItemForm, OptionsManager } from "@/features/admin/menu-admin";
import { ADMIN_ROLES } from "@/lib/auth/permissions";
import { requireRole } from "@/lib/auth/session";
import { formatMoney, minorToMajorString } from "@/lib/money";
import { firstParam } from "@/lib/utils";
import { getSettings } from "@/server/repositories/settings-repository";
import { getMenuItemForAdmin, listCategoriesForAdmin } from "@/server/services/menu-service";

export const metadata: Metadata = { title: "Edit menu item" };

export default async function EditMenuItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  await requireRole(ADMIN_ROLES, `/admin/menu/${id}`);
  const [item, categories, settings] = await Promise.all([getMenuItemForAdmin(id.slice(0, 64)), listCategoriesForAdmin(), getSettings()]);
  if (!item) notFound();
  const created = firstParam((await searchParams).created);
  const money = (minor: number) => formatMoney(minor, settings.currency, settings.locale);

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title={item.name}
        description={
          item.archivedAt
            ? "This item is archived and hidden from customers."
            : "Changes apply to new orders only; past receipts keep their original prices."
        }
        actions={
          <Link href="/admin/menu" className={buttonVariants({ variant: "ghost" })}>
            ← All items
          </Link>
        }
      />
      {created ? <Alert tone="success">Item created. Add options or extras below if needed.</Alert> : null}
      <Card>
        <CardHeader title="Details" />
        <CardBody className="py-6">
          <MenuItemForm
            categories={categories}
            currency={settings.currency}
            item={{
              id: item.id,
              categoryId: item.categoryId,
              name: item.name,
              description: item.description,
              price: minorToMajorString(item.priceMinor, settings.currency),
              imageUrl: item.imageUrl,
              dietaryLabels: item.dietaryLabels,
              isPublished: item.isPublished,
              isAvailable: item.isAvailable,
              isFeatured: item.isFeatured,
              prepTimeMinutes: item.prepTimeMinutes,
              sortOrder: item.sortOrder,
            }}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Size / portion options"
          description="Customers must choose exactly one available option. The price change is added to the base price."
        />
        <CardBody>
          <OptionsManager
            kind="variant"
            menuItemId={item.id}
            currency={settings.currency}
            options={item.variants.map((variant) => ({
              id: variant.id,
              name: variant.name,
              isAvailable: variant.isAvailable,
              priceLabel: `${money(item.priceMinor + variant.priceDeltaMinor)} (${variant.priceDeltaMinor >= 0 ? "+" : "−"}${money(Math.abs(variant.priceDeltaMinor))})`,
            }))}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Extras / add-ons" description="Optional extras customers may add, each at most once per line." />
        <CardBody>
          <OptionsManager
            kind="addon"
            menuItemId={item.id}
            currency={settings.currency}
            options={item.addOns.map((addOn) => ({
              id: addOn.id,
              name: addOn.name,
              isAvailable: addOn.isAvailable,
              priceLabel: `+${money(addOn.priceMinor)}`,
            }))}
          />
        </CardBody>
      </Card>
    </div>
  );
}
