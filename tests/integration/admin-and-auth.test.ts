import { beforeEach, describe, expect, it } from "vitest";
import { getAuth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { getPublicMenu } from "@/server/repositories/menu-repository";
import {
  addVariant,
  archiveMenuItem,
  createCategory,
  createMenuItem,
  deleteCategory,
  setMenuItemAvailability,
  updateMenuItem,
} from "@/server/services/menu-service";
import { updateSettings } from "@/server/services/settings-service";
import { changeUserRole, createStaffAccount, setUserActive } from "@/server/services/staff-service";
import { createTable, deleteTable } from "@/server/services/table-service";
import { adminActor, customerActor, kitchenActor, resetDatabase, seedSettings } from "../support/fixtures";

beforeEach(async () => {
  await resetDatabase();
  await seedSettings();
});

const itemInput = (categoryId: string) => ({
  categoryId,
  name: "Masala Dosa",
  description: "Crisp rice crepe",
  price: 18_000,
  imageUrl: null,
  dietaryLabels: ["VEGETARIAN" as const],
  isPublished: true,
  isAvailable: true,
  isFeatured: false,
  prepTimeMinutes: 10,
  sortOrder: 0,
});

describe("menu management", () => {
  it("supports admin CRUD with audit events and blocks other roles", async () => {
    const admin = await adminActor();
    const category = await createCategory(admin, { name: "South Indian", sortOrder: 0, isActive: true });
    const item = await createMenuItem(admin, itemInput(category.id));
    expect(item.slug).toBe("masala-dosa");
    await updateMenuItem(admin, item.id, { ...itemInput(category.id), price: 20_000 });
    await addVariant(admin, { menuItemId: item.id, name: "Ghee roast", priceDelta: 4_000, isAvailable: true, sortOrder: 0 });
    await expect(
      addVariant(admin, { menuItemId: item.id, name: "Mini", priceDelta: -30_000, isAvailable: true, sortOrder: 1 }),
    ).rejects.toThrow(/negative/);

    const actions = (await prisma.auditEvent.findMany({ orderBy: { createdAt: "asc" } })).map((event) => event.action);
    expect(actions).toEqual(["menu.category.create", "menu.item.create", "menu.item.price_change", "menu.variant.create"]);

    for (const actor of [await customerActor(), await kitchenActor()]) {
      await expect(createMenuItem(actor, itemInput(category.id))).rejects.toThrow(ForbiddenError);
      await expect(setMenuItemAvailability(actor, item.id, false)).rejects.toThrow(ForbiddenError);
    }
  });

  it("hides sold-out flags, archived items and inactive categories correctly on the public menu", async () => {
    const admin = await adminActor();
    const category = await createCategory(admin, { name: "Mains", sortOrder: 0, isActive: true });
    const item = await createMenuItem(admin, itemInput(category.id));
    await setMenuItemAvailability(admin, item.id, false);
    let menu = await getPublicMenu();
    expect(menu.categories[0].items[0]).toMatchObject({ id: item.id, isAvailable: false }); // shown as sold out
    expect((await getPublicMenu({ availableOnly: true })).categories).toHaveLength(0);

    await archiveMenuItem(admin, item.id);
    menu = await getPublicMenu();
    expect(menu.categories).toHaveLength(0);
    await expect(deleteCategory(admin, category.id)).rejects.toThrow(ConflictError); // archived items still reference it
  });

  it("protects tables with history and validates unique labels", async () => {
    const admin = await adminActor();
    const table = await createTable(admin, { label: "T1", capacity: 4, isActive: true });
    await expect(createTable(admin, { label: "T1", capacity: 2, isActive: true })).rejects.toThrow(ValidationError);
    await prisma.reservation.create({
      data: {
        code: "HIST2222",
        tableId: table!.id,
        partySize: 2,
        startsAt: new Date("2025-01-01T12:00:00Z"),
        endsAt: new Date("2025-01-01T13:30:00Z"),
        status: "COMPLETED",
        contactName: "x",
        contactPhone: "1234567",
      },
    });
    await expect(deleteTable(admin, table!.id)).rejects.toThrow(/Deactivate/);
  });

  it("does not let the currency change while priced menu items exist", async () => {
    const admin = await adminActor();
    const category = await createCategory(admin, { name: "Mains", sortOrder: 0, isActive: true });
    await createMenuItem(admin, itemInput(category.id));
    const settings = await prisma.restaurantSettings.findUniqueOrThrow({ where: { id: 1 } });
    await expect(
      updateSettings(admin, {
        name: "X",
        currency: "USD",
        locale: "en-US",
        timezone: "America/New_York",
        taxRate: 500,
        serviceCharge: 0,
        deliveryFee: 0,
        enabledOrderTypes: settings.enabledOrderTypes,
        enabledPaymentMethods: settings.enabledPaymentMethods,
        acceptingOrders: true,
        customerCancelWindowMinutes: 5,
        reservationDurationMinutes: 90,
        reservationSlotMinutes: 30,
        reservationLeadMinutes: 60,
        reservationMaxDaysAhead: 30,
        maxPartySize: 10,
        autoConfirmReservations: true,
        kitchenLateMinutes: 20,
      }),
    ).rejects.toThrow(/Currency cannot be changed/);
  });
});

describe("staff management", () => {
  it("creates staff, changes roles and always keeps one active admin", async () => {
    const admin = await adminActor();
    const { id } = await createStaffAccount(admin, {
      name: "New Cook",
      email: "Cook@Example.test",
      password: "a-very-long-password",
      role: "KITCHEN_STAFF",
    });
    const staff = await prisma.user.findUniqueOrThrow({ where: { id }, include: { accounts: true } });
    expect(staff.email).toBe("cook@example.test");
    expect(staff.accounts[0].providerId).toBe("credential");
    expect(staff.accounts[0].password).not.toContain("a-very-long-password"); // stored as a hash
    await expect(
      createStaffAccount(admin, { name: "Dup", email: "cook@example.test", password: "a-very-long-password", role: "ADMIN" }),
    ).rejects.toThrow(/already exists/);

    await expect(changeUserRole(admin, { userId: admin.id, role: "CUSTOMER" })).rejects.toThrow(/own role/);
    await expect(setUserActive(admin, { userId: admin.id, isActive: false })).rejects.toThrow(/own account/);
    const other = await adminActor();
    await changeUserRole(other, { userId: admin.id, role: "CUSTOMER" });
    await expect(changeUserRole(admin, { userId: other.id, role: "CUSTOMER" })).rejects.toThrow(/At least one active administrator/);
    await expect(changeUserRole(await kitchenActor(), { userId: id, role: "ADMIN" })).rejects.toThrow(ForbiddenError);
  });

  it("revokes sessions when an account is deactivated", async () => {
    const admin = await adminActor();
    const customer = await customerActor();
    await prisma.session.create({ data: { userId: customer.id, token: "tok-1", expiresAt: new Date(Date.now() + 3_600_000) } });
    await setUserActive(admin, { userId: customer.id, isActive: false });
    expect(await prisma.session.count({ where: { userId: customer.id } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: customer.id } })).isActive).toBe(false);
  });
});

describe("authentication (Better Auth)", () => {
  const password = "correct-horse-battery";

  it("registers customers and ignores attempts to self-assign a role", async () => {
    const body = { name: "Mallory", email: "mallory@example.test", password, role: "ADMIN", isActive: false };
    await getAuth()
      .api.signUpEmail({ body: body as unknown as { name: string; email: string; password: string } })
      .catch(() => null);
    const user = await prisma.user.findUnique({ where: { email: "mallory@example.test" } });
    // Either the request is rejected outright or the user is created as an active CUSTOMER.
    if (user) expect(user).toMatchObject({ role: "CUSTOMER", isActive: true });
    expect(await prisma.user.count({ where: { role: "ADMIN" } })).toBe(0);
  });

  it("signs in with the right password and rejects wrong passwords and deactivated users", async () => {
    await getAuth().api.signUpEmail({ body: { name: "Asha", email: "asha@example.test", password } });
    const ok = await getAuth().api.signInEmail({ body: { email: "asha@example.test", password } });
    expect(ok.user.email).toBe("asha@example.test");
    await expect(getAuth().api.signInEmail({ body: { email: "asha@example.test", password: "wrong-password-123" } })).rejects.toThrow();

    await prisma.user.update({ where: { email: "asha@example.test" }, data: { isActive: false } });
    await expect(getAuth().api.signInEmail({ body: { email: "asha@example.test", password } })).rejects.toThrow();
  });

  it("rate limits repeated sign-in attempts from the same client", async () => {
    const attempt = () =>
      getAuth().handler(
        new Request("http://localhost:3000/api/auth/sign-in/email", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-forwarded-for": "203.0.113.7" },
          body: JSON.stringify({ email: "nobody@example.test", password: "wrong-password-123" }),
        }),
      );
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await attempt()).status);
    expect(statuses.slice(0, 5).every((status) => status === 401)).toBe(true);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  it("rejects passwords shorter than 10 characters", async () => {
    await expect(getAuth().api.signUpEmail({ body: { name: "Short", email: "short@example.test", password: "short" } })).rejects.toThrow();
  });
});
