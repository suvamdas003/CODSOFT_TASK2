import { existsSync } from "node:fs";
import { expect, request, test as setup } from "@playwright/test";

/**
 * Signs in once per role through the real login form and stores the session,
 * so the specs don't repeat logins. A saved session that is still valid is
 * reused — sign-in is rate limited (5 attempts per minute per client).
 */
const accounts = [
  {
    role: "customer",
    userRole: "CUSTOMER",
    email: process.env.SEED_CUSTOMER_EMAIL,
    password: process.env.SEED_CUSTOMER_PASSWORD,
    home: /\/menu$/,
  },
  {
    role: "kitchen",
    userRole: "KITCHEN_STAFF",
    email: process.env.SEED_KITCHEN_EMAIL,
    password: process.env.SEED_KITCHEN_PASSWORD,
    home: /\/kitchen$/,
  },
  { role: "admin", userRole: "ADMIN", email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD, home: /\/admin$/ },
];

for (const account of accounts) {
  setup(`sign in as ${account.role}`, async ({ page, baseURL }) => {
    const statePath = `tests/e2e/.auth/${account.role}.json`;
    if (existsSync(statePath)) {
      const api = await request.newContext({ baseURL, storageState: statePath });
      const session = await (await api.get("/api/auth/get-session")).json().catch(() => null);
      await api.dispose();
      if (session?.user?.role === account.userRole) return;
    }

    if (!account.email || !account.password) throw new Error(`Missing SEED_* credentials for ${account.role} in .env`);
    await page.goto("/login");
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(account.home);
    await page.context().storageState({ path: statePath });
  });
}
