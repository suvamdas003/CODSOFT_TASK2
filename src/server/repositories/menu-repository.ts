import { DietaryLabel } from "@/generated/prisma/enums";
import { prisma, type Prisma } from "@/lib/db";

export type MenuFilters = {
  q?: string;
  category?: string;
  dietary?: DietaryLabel;
  availableOnly?: boolean;
};

const publicItemSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  priceMinor: true,
  imageUrl: true,
  dietaryLabels: true,
  isAvailable: true,
  isFeatured: true,
  prepTimeMinutes: true,
  categoryId: true,
  variants: {
    where: { isAvailable: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, priceDeltaMinor: true },
  },
  addOns: {
    where: { isAvailable: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, priceMinor: true },
  },
} satisfies Prisma.MenuItemSelect;

export type PublicMenuItem = Prisma.MenuItemGetPayload<{ select: typeof publicItemSelect }>;

/** Published, non-archived items in active categories. Search is parameterised by Prisma. */
export async function getPublicMenu(filters: MenuFilters = {}) {
  const itemWhere: Prisma.MenuItemWhereInput = {
    isPublished: true,
    archivedAt: null,
    ...(filters.availableOnly ? { isAvailable: true } : {}),
    ...(filters.dietary ? { dietaryLabels: { has: filters.dietary } } : {}),
    ...(filters.q
      ? {
          OR: [{ name: { contains: filters.q, mode: "insensitive" } }, { description: { contains: filters.q, mode: "insensitive" } }],
        }
      : {}),
  };

  const categories = await prisma.menuCategory.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      items: {
        where: itemWhere,
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: publicItemSelect,
      },
    },
  });

  const allCategories = categories.map(({ id, name, slug }) => ({ id, name, slug }));
  const visible = categories
    .filter((category) => !filters.category || category.slug === filters.category)
    .filter((category) => category.items.length > 0);
  return { categories: visible, allCategories };
}

export async function getFeaturedItems(limit = 6) {
  return prisma.menuItem.findMany({
    where: { isPublished: true, isFeatured: true, archivedAt: null, category: { isActive: true } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    take: limit,
    select: publicItemSelect,
  });
}
