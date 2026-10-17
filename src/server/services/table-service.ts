import { ADMIN_ROLES, assertRole, type Actor } from "@/lib/auth/permissions";
import { isUniqueViolation, prisma } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/server/services/audit-service";
import { BLOCKING_RESERVATION_STATUSES } from "@/server/services/reservation-slots";

export type TableInput = { label: string; capacity: number; location?: string; isActive: boolean };

function uniqueLabelError(error: unknown): never {
  if (isUniqueViolation(error)) throw new ValidationError("A table with this label already exists.", { label: ["Label already in use."] });
  throw error;
}

export async function listTables() {
  return prisma.restaurantTable.findMany({
    orderBy: [{ isActive: "desc" }, { label: "asc" }],
    include: {
      _count: {
        select: {
          reservations: { where: { status: { in: [...BLOCKING_RESERVATION_STATUSES] }, endsAt: { gt: new Date() } } },
        },
      },
    },
  });
}

export async function listActiveTablesForDineIn() {
  return prisma.restaurantTable.findMany({
    where: { isActive: true },
    orderBy: { label: "asc" },
    select: { id: true, label: true, capacity: true },
  });
}

export async function createTable(actor: Actor, input: TableInput) {
  assertRole(actor, ADMIN_ROLES);
  try {
    return await prisma.$transaction(async (tx) => {
      const table = await tx.restaurantTable.create({ data: { ...input, location: input.location ?? null } });
      await recordAudit(tx, {
        actorId: actor.id,
        action: "table.create",
        entityType: "RestaurantTable",
        entityId: table.id,
        summary: `Created table ${table.label} (seats ${table.capacity})`,
      });
      return table;
    });
  } catch (error) {
    uniqueLabelError(error);
  }
}

export async function updateTable(actor: Actor, id: string, input: TableInput) {
  assertRole(actor, ADMIN_ROLES);
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.restaurantTable.findUnique({ where: { id } });
      if (!existing) throw new NotFoundError("Table not found.");
      if (input.capacity < existing.capacity) {
        const tooLarge = await tx.reservation.count({
          where: {
            tableId: id,
            status: { in: [...BLOCKING_RESERVATION_STATUSES] },
            endsAt: { gt: new Date() },
            partySize: { gt: input.capacity },
          },
        });
        if (tooLarge > 0) {
          throw new ConflictError(`${tooLarge} upcoming reservation(s) on this table exceed the new capacity. Move them first.`);
        }
      }
      const table = await tx.restaurantTable.update({ where: { id }, data: { ...input, location: input.location ?? null } });
      await recordAudit(tx, {
        actorId: actor.id,
        action: "table.update",
        entityType: "RestaurantTable",
        entityId: id,
        summary: `Updated table ${table.label}`,
        metadata: { capacity: table.capacity, isActive: table.isActive },
      });
      return table;
    });
  } catch (error) {
    uniqueLabelError(error);
  }
}

/** Tables with reservation history cannot be deleted (deactivate them instead). */
export async function deleteTable(actor: Actor, id: string) {
  assertRole(actor, ADMIN_ROLES);
  await prisma.$transaction(async (tx) => {
    const table = await tx.restaurantTable.findUnique({ where: { id }, include: { _count: { select: { reservations: true } } } });
    if (!table) throw new NotFoundError("Table not found.");
    if (table._count.reservations > 0) {
      throw new ConflictError("This table has reservation history. Deactivate it instead of deleting it.");
    }
    await tx.restaurantTable.delete({ where: { id } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "table.delete",
      entityType: "RestaurantTable",
      entityId: id,
      summary: `Deleted table ${table.label}`,
    });
  });
}
