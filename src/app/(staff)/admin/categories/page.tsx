import type { Metadata } from "next";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/display";
import { CategoryForm, DeleteCategoryButton } from "@/features/admin/menu-admin";
import { ADMIN_ROLES } from "@/lib/auth/permissions";
import { requireRole } from "@/lib/auth/session";
import { listCategoriesForAdmin } from "@/server/services/menu-service";

export const metadata: Metadata = { title: "Categories" };

export default async function CategoriesPage() {
  await requireRole(ADMIN_ROLES, "/admin/categories");
  const categories = await listCategoriesForAdmin();
  return (
    <div className="space-y-6">
      <PageHeader title="Menu categories" description="Inactive categories and their items are hidden from customers." />
      <Card>
        <CardHeader title="Add a category" />
        <CardBody>
          <CategoryForm />
        </CardBody>
      </Card>
      {categories.length === 0 ? (
        <EmptyState title="No categories yet" description="Create one above to start building your menu." />
      ) : (
        <Card>
          <CardHeader title="Existing categories" />
          <ul className="divide-y divide-stone-100">
            {categories.map((category) => (
              <li key={category.id} className="space-y-2 px-5 py-4">
                <div className="flex items-center justify-between text-sm text-stone-500">
                  <span>{category._count.items} current item(s)</span>
                  <DeleteCategoryButton id={category.id} name={category.name} />
                </div>
                <CategoryForm category={category} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
