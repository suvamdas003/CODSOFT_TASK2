import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardBody, EmptyState, PageHeader } from "@/components/ui/display";
import { MenuItemForm } from "@/features/admin/menu-admin";
import { ADMIN_ROLES } from "@/lib/auth/permissions";
import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/server/repositories/settings-repository";
import { listCategoriesForAdmin } from "@/server/services/menu-service";

export const metadata: Metadata = { title: "New menu item" };

export default async function NewMenuItemPage() {
  await requireRole(ADMIN_ROLES, "/admin/menu/new");
  const [categories, settings] = await Promise.all([listCategoriesForAdmin(), getSettings()]);
  return (
    <div className="max-w-3xl">
      <PageHeader title="New menu item" description="You can add size options and extras after creating the item." />
      {categories.length === 0 ? (
        <EmptyState
          title="Create a category first"
          action={
            <Link href="/admin/categories" className={buttonVariants()}>
              Manage categories
            </Link>
          }
        />
      ) : (
        <Card>
          <CardBody className="py-6">
            <MenuItemForm categories={categories} currency={settings.currency} />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
