import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Role } from "@/generated/prisma/enums";
import { getAuth } from "@/lib/auth/auth";
import { assertRole, type Actor } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";

/**
 * Resolves the signed-in user for the current request. The session is
 * verified by Better Auth; role and active flag are always re-read from the
 * database so role changes and deactivations take effect immediately.
 */
export const getCurrentUser = cache(async (): Promise<Actor | null> => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
});

function loginPath(next?: string) {
  return next ? `/login?next=${encodeURIComponent(next)}` : "/login";
}

/** For pages: redirects to the login page when signed out. */
export async function requireUser(next?: string): Promise<Actor> {
  const user = await getCurrentUser();
  if (!user) redirect(loginPath(next));
  return user;
}

/** For pages: redirects to login, or to the access-denied page for wrong roles. */
export async function requireRole(roles: readonly Role[], next?: string): Promise<Actor> {
  const user = await requireUser(next);
  if (!roles.includes(user.role)) redirect("/access-denied");
  return user;
}

/** For server actions and route handlers: throws Unauthorized/Forbidden errors. */
export async function getActor(roles?: readonly Role[]): Promise<Actor> {
  const user = await getCurrentUser();
  if (roles) {
    assertRole(user, roles);
    return user;
  }
  assertRole(user, ["CUSTOMER", "KITCHEN_STAFF", "ADMIN"]);
  return user;
}
