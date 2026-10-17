import type { DietaryLabel } from "@/generated/prisma/enums";
import { ADMIN_ROLES, assertRole, type Actor } from "@/lib/auth/permissions";
import { isUniqueViolation, prisma, type Db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { generateCode, slugify } from "@/lib/utils";
import { recordAudit } from "@/server/services/audit-service";

export type CategoryInput = { name: string; description?: string; sortOrder: number; isActive: boolean };

export type MenuItemInput = {
  categoryId: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string | null;
  dietaryLabels: DietaryLabel[];
  isPublished: boolean;
  isAvailable: boolean;
  isFeatured: boolean;
  prepTimeMinutes: number | null;
  sortOrder: number;
};

export type VariantInput = { menuItemId: string; name: string; priceDelta: number; isAvailable: boolean; sortOrder: number };
export type AddOnInput = { menuItemId: string; name: string; price: number; isAvailable: boolean; sortOrder: number };

async function uniqueSlug(db: Db, base: string, model: "category" | "item", excludeId?: string): Promise<string> {
  const root = slugify(base) || "item";
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = attempt === 0 ? root : `${root}-${generateCode(4).toLowerCase()}`;
    const existing =
      model === "category"
        ? await db.menuCategory.findUnique({ where: { slug: candidate }, select: { id: true } })
        : await db.menuItem.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!existing || existing.id === excludeId) return candidate;
  }
  return `${root}-${generateCode(8).toLowerCase()}`;
}

// ─── Categories ─────────────────────────────────────────────────────────────

export async function createCategory(actor: Actor, input: CategoryInput) {
  assertRole(actor, ADMIN_ROLES);
  try {
    return await prisma.$transaction(async (tx) => {
      const category = await tx.menuCategory.create({
        data: { ...input, description: input.description ?? null, slug: await uniqueSlug(tx, input.name, "category") },
      });
      await recordAudit(tx, {
        actorId: actor.id,
        action: "menu.category.create",
        entityType: "MenuCategory",
        entityId: category.id,
        summary: `Created category “${category.name}”`,
      });
      return category;
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new ValidationError("A category with this name already exists.", { name: ["Name already in use."] });
    throw error;
  }
}

export async function updateCategory(actor: Actor, id: string, input: CategoryInput) {
  assertRole(actor, ADMIN_ROLES);
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.menuCategory.findUnique({ where: { id } });
      if (!existing) throw new NotFoundError("Category not found.");
      const category = await tx.menuCategory.update({
        where: { id },
        data: {
          ...input,
          description: input.description ?? null,
          slug: existing.name === input.name ? existing.slug : await uniqueSlug(tx, input.name, "category", id),
        },
      });
      await recordAudit(tx, {
        actorId: actor.id,
        action: "menu.category.update",
        entityType: "MenuCategory",
        entityId: id,
        summary: `Updated category “${category.name}”`,
        metadata: { isActive: category.isActive },
      });
      return category;
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new ValidationError("A category with this name already exists.", { name: ["Name already in use."] });
    throw error;
  }
}

export async function deleteCategory(actor: Actor, id: string) {
  assertRole(actor, ADMIN_ROLES);
  await prisma.$transaction(async (tx) => {
    const category = await tx.menuCategory.findUnique({ where: { id }, include: { _count: { select: { items: true } } } });
    if (!category) throw new NotFoundError("Category not found.");
    if (category._count.items > 0) {
      throw new ConflictError("This category still contains menu items. Move or archive them first, or deactivate the category instead.");
    }
    await tx.menuCategory.delete({ where: { id } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "menu.category.delete",
      entityType: "MenuCategory",
      entityId: id,
      summary: `Deleted category “${category.name}”`,
    });
  });
}

// ─── Items ──────────────────────────────────────────────────────────────────

function itemData(input: MenuItemInput) {
  return {
    categoryId: input.categoryId,
    name: input.name,
    description: input.description,
    priceMinor: input.price,
    imageUrl: input.imageUrl,
    dietaryLabels: input.dietaryLabels,
    isPublished: input.isPublished,
    isAvailable: input.isAvailable,
    isFeatured: input.isFeatured,
    prepTimeMinutes: input.prepTimeMinutes,
    sortOrder: input.sortOrder,
  };
}

async function assertCategoryExists(db: Db, categoryId: string) {
  const category = await db.menuCategory.findUnique({ where: { id: categoryId }, select: { id: true } });
  if (!category) throw new ValidationError("Choose a valid category.", { categoryId: ["Choose a valid category."] });
}

export async function createMenuItem(actor: Actor, input: MenuItemInput) {
  assertRole(actor, ADMIN_ROLES);
  return prisma.$transaction(async (tx) => {
    await assertCategoryExists(tx, input.categoryId);
    const item = await tx.menuItem.create({ data: { ...itemData(input), slug: await uniqueSlug(tx, input.name, "item") } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "menu.item.create",
      entityType: "MenuItem",
      entityId: item.id,
      summary: `Created menu item “${item.name}”`,
      metadata: { priceMinor: item.priceMinor },
    });
    return item;
  });
}

export async function updateMenuItem(actor: Actor, id: string, input: MenuItemInput) {
  assertRole(actor, ADMIN_ROLES);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.menuItem.findUnique({ where: { id } });
    if (!existing || existing.archivedAt) throw new NotFoundError("Menu item not found.");
    await assertCategoryExists(tx, input.categoryId);
    const item = await tx.menuItem.update({
      where: { id },
      data: {
        ...itemData(input),
        slug: existing.name === input.name ? existing.slug : await uniqueSlug(tx, input.name, "item", id),
      },
    });
    const priceChanged = existing.priceMinor !== item.priceMinor;
    await recordAudit(tx, {
      actorId: actor.id,
      action: priceChanged ? "menu.item.price_change" : "menu.item.update",
      entityType: "MenuItem",
      entityId: id,
      summary: priceChanged
        ? `Changed price of “${item.name}” from ${existing.priceMinor} to ${item.priceMinor} (minor units)`
        : `Updated menu item “${item.name}”`,
      metadata: {
        before: { priceMinor: existing.priceMinor, isAvailable: existing.isAvailable, isPublished: existing.isPublished },
        after: { priceMinor: item.priceMinor, isAvailable: item.isAvailable, isPublished: item.isPublished },
      },
    });
    return item;
  });
}

export async function setMenuItemAvailability(actor: Actor, id: string, isAvailable: boolean) {
  assertRole(actor, ADMIN_ROLES);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.menuItem.findUnique({ where: { id } });
    if (!existing || existing.archivedAt) throw new NotFoundError("Menu item not found.");
    const item = await tx.menuItem.update({ where: { id }, data: { isAvailable } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "menu.item.availability",
      entityType: "MenuItem",
      entityId: id,
      summary: `Marked “${item.name}” as ${isAvailable ? "available" : "sold out"}`,
    });
    return item;
  });
}

/** Soft delete: hides the item everywhere while keeping order history intact. */
export async function archiveMenuItem(actor: Actor, id: string) {
  assertRole(actor, ADMIN_ROLES);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.menuItem.findUnique({ where: { id } });
    if (!existing || existing.archivedAt) throw new NotFoundError("Menu item not found.");
    const item = await tx.menuItem.update({
      where: { id },
      data: { archivedAt: new Date(), isPublished: false, isFeatured: false },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "menu.item.archive",
      entityType: "MenuItem",
      entityId: id,
      summary: `Archived menu item “${item.name}”`,
    });
    return item;
  });
}

export async function restoreMenuItem(actor: Actor, id: string) {
  assertRole(actor, ADMIN_ROLES);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.menuItem.findUnique({ where: { id } });
    if (!existing || !existing.archivedAt) throw new NotFoundError("Archived menu item not found.");
    const item = await tx.menuItem.update({ where: { id }, data: { archivedAt: null } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "menu.item.restore",
      entityType: "MenuItem",
      entityId: id,
      summary: `Restored menu item “${item.name}” (unpublished)`,
    });
    return item;
  });
}

// ─── Variants & add-ons ─────────────────────────────────────────────────────

async function assertItemEditable(db: Db, menuItemId: string) {
  const item = await db.menuItem.findUnique({
    where: { id: menuItemId },
    select: { id: true, name: true, priceMinor: true, archivedAt: true },
  });
  if (!item || item.archivedAt) throw new NotFoundError("Menu item not found.");
  return item;
}

export async function addVariant(actor: Actor, input: VariantInput) {
  assertRole(actor, ADMIN_ROLES);
  try {
    return await prisma.$transaction(async (tx) => {
      const item = await assertItemEditable(tx, input.menuItemId);
      if (item.priceMinor + input.priceDelta < 0) {
        throw new ValidationError("The variant would make the price negative.", { priceDelta: ["Too large a reduction."] });
      }
      const variant = await tx.itemVariant.create({
        data: {
          menuItemId: input.menuItemId,
          name: input.name,
          priceDeltaMinor: input.priceDelta,
          isAvailable: input.isAvailable,
          sortOrder: input.sortOrder,
        },
      });
      await recordAudit(tx, {
        actorId: actor.id,
        action: "menu.variant.create",
        entityType: "ItemVariant",
        entityId: variant.id,
        summary: `Added variant “${variant.name}” to “${item.name}”`,
      });
      return variant;
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new ValidationError("This item already has a variant with that name.", { name: ["Name already in use."] });
    throw error;
  }
}

export async function setVariantAvailability(actor: Actor, variantId: string, isAvailable: boolean) {
  assertRole(actor, ADMIN_ROLES);
  return prisma.$transaction(async (tx) => {
    const variant = await tx.itemVariant.update({ where: { id: variantId }, data: { isAvailable } }).catch(() => null);
    if (!variant) throw new NotFoundError("Variant not found.");
    await recordAudit(tx, {
      actorId: actor.id,
      action: "menu.variant.availability",
      entityType: "ItemVariant",
      entityId: variantId,
      summary: `Marked variant “${variant.name}” as ${isAvailable ? "available" : "unavailable"}`,
    });
    return variant;
  });
}

export async function deleteVariant(actor: Actor, variantId: string) {
  assertRole(actor, ADMIN_ROLES);
  await prisma.$transaction(async (tx) => {
    const variant = await tx.itemVariant.findUnique({ where: { id: variantId } });
    if (!variant) throw new NotFoundError("Variant not found.");
    await tx.itemVariant.delete({ where: { id: variantId } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "menu.variant.delete",
      entityType: "ItemVariant",
      entityId: variantId,
      summary: `Removed variant “${variant.name}”`,
    });
  });
}

export async function addAddOn(actor: Actor, input: AddOnInput) {
  assertRole(actor, ADMIN_ROLES);
  try {
    return await prisma.$transaction(async (tx) => {
      const item = await assertItemEditable(tx, input.menuItemId);
      const addOn = await tx.addOn.create({
        data: {
          menuItemId: input.menuItemId,
          name: input.name,
          priceMinor: input.price,
          isAvailable: input.isAvailable,
          sortOrder: input.sortOrder,
        },
      });
      await recordAudit(tx, {
        actorId: actor.id,
        action: "menu.addon.create",
        entityType: "AddOn",
        entityId: addOn.id,
        summary: `Added add-on “${addOn.name}” to “${item.name}”`,
      });
      return addOn;
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new ValidationError("This item already has an add-on with that name.", { name: ["Name already in use."] });
    throw error;
  }
}

export async function setAddOnAvailability(actor: Actor, addOnId: string, isAvailable: boolean) {
  assertRole(actor, ADMIN_ROLES);
  return prisma.$transaction(async (tx) => {
    const addOn = await tx.addOn.update({ where: { id: addOnId }, data: { isAvailable } }).catch(() => null);
    if (!addOn) throw new NotFoundError("Add-on not found.");
    await recordAudit(tx, {
      actorId: actor.id,
      action: "menu.addon.availability",
      entityType: "AddOn",
      entityId: addOnId,
      summary: `Marked add-on “${addOn.name}” as ${isAvailable ? "available" : "unavailable"}`,
    });
    return addOn;
  });
}

export async function deleteAddOn(actor: Actor, addOnId: string) {
  assertRole(actor, ADMIN_ROLES);
  await prisma.$transaction(async (tx) => {
    const addOn = await tx.addOn.findUnique({ where: { id: addOnId } });
    if (!addOn) throw new NotFoundError("Add-on not found.");
    await tx.addOn.delete({ where: { id: addOnId } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "menu.addon.delete",
      entityType: "AddOn",
      entityId: addOnId,
      summary: `Removed add-on “${addOn.name}”`,
    });
  });
}

// ─── Admin reads ────────────────────────────────────────────────────────────

export async function listMenuForAdmin(filters: { q?: string; categoryId?: string; archived?: boolean }) {
  return prisma.menuItem.findMany({
    where: {
      archivedAt: filters.archived ? { not: null } : null,
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.q ? { name: { contains: filters.q, mode: "insensitive" } } : {}),
    },
    orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
    include: {
      category: { select: { name: true } },
      _count: { select: { variants: true, addOns: true } },
    },
  });
}

export async function getMenuItemForAdmin(id: string) {
  return prisma.menuItem.findUnique({
    where: { id },
    include: {
      variants: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
      addOns: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
    },
  });
}

export async function listCategoriesForAdmin() {
  return prisma.menuCategory.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { items: { where: { archivedAt: null } } } } },
  });
}
