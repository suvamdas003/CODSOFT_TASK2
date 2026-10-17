import { expect, test, type Browser } from "@playwright/test";

const asRole = (browser: Browser, role: "customer" | "kitchen" | "admin") =>
  browser.newContext({ storageState: `tests/e2e/.auth/${role}.json` });

test.describe.serial("customer → kitchen → admin workflow", () => {
  let orderNumber = "";
  let orderUrl = "";

  test("customer orders from the menu and sees a server-priced order", async ({ browser }) => {
    const context = await asRole(browser, "customer");
    const page = await context.newPage();
    await page.goto("/menu");
    await page.getByRole("button", { name: "Add Masala Chai to cart" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Special instructions").fill("E2E test order");
    await dialog.getByRole("button", { name: /Add to cart/ }).click();
    await dialog.getByRole("link", { name: "Go to cart" }).click();

    await expect(page.getByRole("heading", { name: "Your cart" })).toBeVisible();
    await page.getByLabel("Takeaway").check();
    // Total comes from the server quote: ₹80 + 5% tax = ₹84.00
    await expect(page.getByRole("button", { name: /Place order · ₹84\.00/ })).toBeEnabled();
    await page.getByRole("button", { name: /Place order/ }).click();

    await expect(page).toHaveURL(/\/orders\/[a-z0-9]+\?placed=1/);
    await expect(page.getByText("Thank you — your order has been placed.")).toBeVisible();
    const heading = await page.getByRole("heading", { level: 1 }).textContent();
    orderNumber = heading!.replace("Order ", "").trim();
    orderUrl = new URL(page.url()).pathname;
    await expect(page.getByText("Pending").first()).toBeVisible();
    await context.close();
  });

  test("kitchen accepts the order and the customer page updates", async ({ browser }) => {
    const kitchen = await asRole(browser, "kitchen");
    const page = await kitchen.newPage();
    await page.goto("/kitchen");
    const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name: orderNumber }) });
    await expect(card).toBeVisible();
    await expect(card.getByText("E2E test order")).toBeVisible();
    await card.getByRole("button", { name: "Accept" }).click();
    await expect(card.getByRole("button", { name: "Start preparing" })).toBeVisible();
    await kitchen.close();

    const customer = await asRole(browser, "customer");
    const customerPage = await customer.newPage();
    await customerPage.goto(orderUrl);
    await expect(customerPage.getByText("Accepted by kitchen")).toBeVisible();
    await expect(customerPage.getByText("Confirmed").first()).toBeVisible();
    // Accepted orders can no longer be cancelled by the customer.
    await expect(customerPage.getByRole("button", { name: "Cancel order" })).toHaveCount(0);
    await customer.close();
  });

  test("admin records a manual payment and sees it on the order", async ({ browser }) => {
    const admin = await asRole(browser, "admin");
    const page = await admin.newPage();
    await page.goto(`/admin${orderUrl}`);
    await page.getByLabel("Receipt / reference (optional)").fill("E2E-TILL-1");
    await page.getByRole("button", { name: "Mark as paid (manual)" }).click();
    // The form disappears once the order is paid; the payment record replaces it.
    await expect(page.getByText("Reference: E2E-TILL-1")).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark as paid (manual)" })).toHaveCount(0);
    await expect(page.getByText(/Recorded manually by staff/)).toBeVisible();
    await admin.close();
  });
});

test("admin can mark a menu item sold out, which blocks ordering it", async ({ browser }) => {
  const admin = await asRole(browser, "admin");
  const page = await admin.newPage();
  await page.goto("/admin/menu?q=Cold+Coffee");
  const row = page.getByRole("row").filter({ hasText: "Cold Coffee" });
  await row.getByRole("button", { name: "Mark sold out" }).click();
  await expect(row.getByText("Sold out")).toBeVisible();

  const customer = await asRole(browser, "customer");
  const menu = await customer.newPage();
  await menu.goto("/menu?q=Cold+Coffee");
  const card = menu.getByRole("article").filter({ hasText: "Cold Coffee" });
  await expect(card.getByRole("button", { name: "Sold out" })).toBeDisabled();
  await customer.close();

  // Restore demo data.
  await row.getByRole("button", { name: "Mark available" }).click();
  await expect(row.getByRole("button", { name: "Mark sold out" })).toBeVisible();
  await admin.close();
});

test("customer books a table from the available slots", async ({ browser }) => {
  const context = await asRole(browser, "customer");
  const page = await context.newPage();
  await page.goto("/reservations/new");
  const dateInput = page.getByLabel("Date");
  const max = await dateInput.getAttribute("max");
  // Book near the end of the booking window to avoid clashing with other runs.
  const day = new Date(`${max}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - Math.floor(Math.random() * 10));
  await dateInput.fill(day.toISOString().slice(0, 10));
  await page.getByLabel("Guests").selectOption("2");
  const slot = page.getByRole("button", { name: /^\d{2}:\d{2}$/ }).first();
  await expect(slot).toBeEnabled();
  await slot.click();
  await page.getByLabel("Phone").fill("+91 90000 11111");
  await page.getByRole("button", { name: "Confirm reservation" }).click();
  await expect(page).toHaveURL(/\/reservations\?created=/);
  await expect(page.getByText("Reservation saved")).toBeVisible();
  await context.close();
});

test("role-based access is enforced on pages and APIs", async ({ browser, page }) => {
  // Signed-out visitors are sent to login.
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin/);

  const customer = await asRole(browser, "customer");
  const customerPage = await customer.newPage();
  await customerPage.goto("/kitchen");
  await expect(customerPage).toHaveURL(/\/access-denied/);
  const api = await customerPage.request.get("/api/kitchen/orders");
  expect(api.status()).toBe(403);
  await customer.close();

  const kitchen = await asRole(browser, "kitchen");
  const kitchenPage = await kitchen.newPage();
  await kitchenPage.goto("/admin/menu");
  await expect(kitchenPage).toHaveURL(/\/access-denied/);
  await kitchen.close();
});

test("a new customer can register, and cannot see another customer's order", async ({ browser }) => {
  // Find one of the demo customer's orders.
  const owner = await asRole(browser, "customer");
  const ownerPage = await owner.newPage();
  await ownerPage.goto("/orders");
  const orderLink = ownerPage.getByRole("link", { name: /^DD-\d{6}$/ }).first();
  const orderPath = await orderLink.getAttribute("href");
  expect(orderPath).toMatch(/^\/orders\/[a-z0-9]+$/);
  await owner.close();

  const visitor = await browser.newContext();
  const page = await visitor.newPage();
  await page.goto("/register");
  const email = `e2e-${Date.now()}@example.test`;
  await page.getByLabel("Full name").fill("E2E Newcomer");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("a-long-e2e-password");
  await page.getByLabel("Confirm password").fill("a-long-e2e-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/menu$/);
  await expect(page.getByText("E2E Newcomer")).toBeVisible();

  // Data isolation: the page and the polling API both behave as if the order does not exist.
  await page.goto(orderPath!);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  const api = await page.request.get(`/api${orderPath}`);
  expect(api.status()).toBe(404);
  // Malformed ids are rejected as bad input, not server errors.
  expect((await page.request.get(`/api/orders/${"x".repeat(100)}`)).status()).toBe(422);
  await visitor.close();
});

test("customer can change and then cancel a reservation", async ({ browser }) => {
  const context = await asRole(browser, "customer");
  const page = await context.newPage();
  await page.goto("/reservations");
  const card = page
    .locator("div")
    .filter({ has: page.getByRole("link", { name: "Change" }) })
    .last();
  const before = await card.textContent();
  await card.getByRole("link", { name: "Change" }).click();
  await expect(page.getByRole("heading", { name: /^Reservation [2-9A-Z]{8}$/ })).toBeVisible();
  await page.getByLabel("Guests").selectOption("3");
  const available = page.getByRole("button", { name: /^\d{2}:\d{2}$/ });
  await expect(available.first()).toBeEnabled();
  await available.last().click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/\/reservations\?updated=1/);
  await expect(page.getByText("Reservation updated.")).toBeVisible();
  await expect(page.getByText(/3 guests/).first()).toBeVisible();
  expect(before).toBeTruthy();

  const upcoming = page.locator("section").filter({ has: page.getByRole("heading", { name: "Upcoming" }) });
  const countBefore = await upcoming.getByRole("button", { name: "Cancel" }).count();
  await upcoming.getByRole("button", { name: "Cancel" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel reservation" }).click();
  await expect(upcoming.getByRole("button", { name: "Cancel" })).toHaveCount(countBefore - 1);
  await context.close();
});

test("staff accounts are told they cannot check out", async ({ browser }) => {
  const kitchen = await asRole(browser, "kitchen");
  const page = await kitchen.newPage();
  await page.goto("/menu");
  await page.getByRole("button", { name: "Add Masala Chai to cart" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Add to cart/ })
    .click();
  await page.goto("/cart");
  await expect(page.getByText("Staff accounts cannot place orders")).toBeVisible();
  await expect(page.getByRole("button", { name: /Place order/ })).toHaveCount(0);
  await kitchen.close();
});
