import { Role } from "@/generated/prisma/enums";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";

/** The authenticated principal passed to every server-side service. */
export type Actor = {
  id: string;
  role: Role;
  name: string;
  email: string;
};

export const STAFF_ROLES: readonly Role[] = [Role.KITCHEN_STAFF, Role.ADMIN];
export const KITCHEN_ROLES: readonly Role[] = [Role.KITCHEN_STAFF, Role.ADMIN];
export const ADMIN_ROLES: readonly Role[] = [Role.ADMIN];
export const ORDERING_ROLES: readonly Role[] = [Role.CUSTOMER, Role.ADMIN];

export function hasRole(actor: Actor | null | undefined, roles: readonly Role[]): boolean {
  return Boolean(actor && roles.includes(actor.role));
}

/** Throws unless the actor exists and holds one of `roles`. */
export function assertRole(actor: Actor | null | undefined, roles: readonly Role[]): asserts actor is Actor {
  if (!actor) throw new UnauthorizedError();
  if (!roles.includes(actor.role)) throw new ForbiddenError();
}

export function isStaff(actor: Actor | null | undefined): boolean {
  return hasRole(actor, STAFF_ROLES);
}

/**
 * Object-level authorization: staff may access any record, customers only
 * records they own.
 */
export function canAccessOwnedRecord(actor: Actor, ownerId: string | null): boolean {
  if (isStaff(actor)) return true;
  return ownerId !== null && ownerId === actor.id;
}

/** Where a user lands after signing in, based on role. */
export function homePathForRole(role: Role): string {
  switch (role) {
    case Role.ADMIN:
      return "/admin";
    case Role.KITCHEN_STAFF:
      return "/kitchen";
    default:
      return "/menu";
  }
}
