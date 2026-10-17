import { beforeEach, describe, expect, it } from "vitest";
import { getAuth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { bootstrapAdminAccount } from "@/server/services/staff-service";
import { createActor, resetDatabase, seedSettings } from "../support/fixtures";

beforeEach(async () => {
  await resetDatabase();
  await seedSettings();
});

describe("production admin bootstrap (regression: no admin without demo seed)", () => {
  const password = "a-strong-admin-password";

  it("creates a working administrator account and audits it", async () => {
    const result = await bootstrapAdminAccount({ name: "Owner", email: "Owner@Restaurant.example", password });
    expect(result.created).toBe(true);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "owner@restaurant.example" } });
    expect(user).toMatchObject({ role: "ADMIN", isActive: true });
    const signIn = await getAuth().api.signInEmail({ body: { email: "owner@restaurant.example", password } });
    expect(signIn.user.id).toBe(user.id);
    expect(await prisma.auditEvent.count({ where: { action: "staff.bootstrap_create" } })).toBe(1);
  });

  it("refuses weak passwords, invalid emails and silent takeover of existing accounts", async () => {
    await expect(bootstrapAdminAccount({ name: "x", email: "a@b.example", password: "short" })).rejects.toThrow(ValidationError);
    await expect(bootstrapAdminAccount({ name: "x", email: "not-an-email", password })).rejects.toThrow(/valid email/);
    const customer = await createActor("CUSTOMER");
    await expect(bootstrapAdminAccount({ name: "x", email: customer.email, password })).rejects.toThrow(/already exists/);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: customer.id } })).role).toBe("CUSTOMER");
  });

  it("promotes and reactivates an existing account only when explicitly asked", async () => {
    const staff = await createActor("KITCHEN_STAFF");
    await prisma.user.update({ where: { id: staff.id }, data: { isActive: false } });
    const result = await bootstrapAdminAccount({ name: "x", email: staff.email, password, promoteExisting: true });
    expect(result).toEqual({ id: staff.id, created: false });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: staff.id } })).toMatchObject({ role: "ADMIN", isActive: true });
  });
});
