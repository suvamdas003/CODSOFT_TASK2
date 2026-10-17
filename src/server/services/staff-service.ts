import { hashPassword } from "better-auth/crypto";
import { Role } from "@/generated/prisma/enums";
import { ADMIN_ROLES, assertRole, type Actor } from "@/lib/auth/permissions";
import { isUniqueViolation, prisma, type Prisma, type Tx } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { humanize } from "@/lib/utils";
import { recordAudit } from "@/server/services/audit-service";

/**
 * Creates a credential account the same way Better Auth does (user row +
 * "credential" account holding the scrypt hash). Used by the admin UI and seed.
 */
export async function createCredentialUser(
  tx: Tx,
  input: { name: string; email: string; password: string; role: Role; emailVerified?: boolean },
) {
  const passwordHash = await hashPassword(input.password);
  const user = await tx.user.create({
    data: {
      name: input.name,
      email: input.email.toLowerCase(),
      emailVerified: input.emailVerified ?? false,
      role: input.role,
      isActive: true,
    },
  });
  await tx.account.create({
    data: { userId: user.id, accountId: user.id, providerId: "credential", password: passwordHash },
  });
  return user;
}

/**
 * Production bootstrap: creates the first administrator (or, with
 * `promoteExisting`, promotes and reactivates an existing account without
 * changing its password). Run via `npm run admin:create`; never via the demo seed.
 */
export async function bootstrapAdminAccount(input: { name: string; email: string; password: string; promoteExisting?: boolean }) {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("ADMIN_EMAIL is not a valid email address.");
  if (input.password.length < 12 || input.password.length > 128) {
    throw new ValidationError("ADMIN_PASSWORD must be 12–128 characters.");
  }
  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { email } });
    if (existing) {
      if (!input.promoteExisting) {
        throw new ValidationError(`An account for ${email} already exists. Set ADMIN_PROMOTE_EXISTING=true to promote it to admin.`);
      }
      await tx.user.update({ where: { id: existing.id }, data: { role: Role.ADMIN, isActive: true } });
      await recordAudit(tx, {
        actorId: null,
        action: "staff.bootstrap_promote",
        entityType: "User",
        entityId: existing.id,
        summary: `Promoted ${email} to admin via bootstrap script`,
      });
      return { id: existing.id, created: false };
    }
    const user = await createCredentialUser(tx, {
      name: input.name.trim() || "Administrator",
      email,
      password: input.password,
      role: Role.ADMIN,
    });
    await recordAudit(tx, {
      actorId: null,
      action: "staff.bootstrap_create",
      entityType: "User",
      entityId: user.id,
      summary: `Created administrator ${email} via bootstrap script`,
    });
    return { id: user.id, created: true };
  });
}

export async function createStaffAccount(actor: Actor, input: { name: string; email: string; password: string; role: Role }) {
  assertRole(actor, ADMIN_ROLES);
  try {
    return await prisma.$transaction(async (tx) => {
      const user = await createCredentialUser(tx, input);
      await recordAudit(tx, {
        actorId: actor.id,
        action: "staff.create",
        entityType: "User",
        entityId: user.id,
        summary: `Created ${humanize(input.role).toLowerCase()} account for ${user.email}`,
      });
      return { id: user.id };
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new ValidationError("An account with this email already exists.", { email: ["Email already in use."] });
    throw error;
  }
}

async function assertNotLastAdmin(tx: Tx, userId: string) {
  const activeAdmins = await tx.user.count({ where: { role: Role.ADMIN, isActive: true, id: { not: userId } } });
  if (activeAdmins === 0) throw new ValidationError("At least one active administrator is required.");
}

export async function changeUserRole(actor: Actor, input: { userId: string; role: Role }) {
  assertRole(actor, ADMIN_ROLES);
  if (input.userId === actor.id) throw new ValidationError("You cannot change your own role.");
  await prisma.$transaction(async (tx) => {
    // Serialise admin-count checks so two admins cannot demote each other concurrently.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(4242001)::text AS locked`;
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user) throw new NotFoundError("User not found.");
    if (user.role === input.role) return;
    if (user.role === Role.ADMIN) await assertNotLastAdmin(tx, user.id);
    await tx.user.update({ where: { id: user.id }, data: { role: input.role } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "staff.role_change",
      entityType: "User",
      entityId: user.id,
      summary: `Changed ${user.email} from ${user.role} to ${input.role}`,
    });
  });
}

export async function setUserActive(actor: Actor, input: { userId: string; isActive: boolean }) {
  assertRole(actor, ADMIN_ROLES);
  if (input.userId === actor.id) throw new ValidationError("You cannot deactivate your own account.");
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(4242001)::text AS locked`;
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user) throw new NotFoundError("User not found.");
    if (user.isActive === input.isActive) return;
    if (!input.isActive && user.role === Role.ADMIN) await assertNotLastAdmin(tx, user.id);
    await tx.user.update({ where: { id: user.id }, data: { isActive: input.isActive } });
    // Revoke existing sessions immediately on deactivation.
    if (!input.isActive) await tx.session.deleteMany({ where: { userId: user.id } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: input.isActive ? "staff.activate" : "staff.deactivate",
      entityType: "User",
      entityId: user.id,
      summary: `${input.isActive ? "Reactivated" : "Deactivated"} ${user.email}`,
    });
  });
}

export async function listUsers(actor: Actor, filters: { role?: Role; q?: string; page: number }, pageSize = 25) {
  assertRole(actor, ADMIN_ROLES);
  const where: Prisma.UserWhereInput = {};
  if (filters.role) where.role = filters.role;
  if (filters.q) {
    where.OR = [{ name: { contains: filters.q, mode: "insensitive" } }, { email: { contains: filters.q, mode: "insensitive" } }];
  }
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: [{ role: "desc" }, { createdAt: "desc" }],
      skip: (filters.page - 1) * pageSize,
      take: pageSize,
      select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
    }),
    prisma.user.count({ where }),
  ]);
  return { users, total, page: filters.page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}
