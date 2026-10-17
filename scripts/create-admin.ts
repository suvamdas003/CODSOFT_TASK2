/**
 * Creates the first DineDesk administrator for a real deployment.
 *
 * Reads ADMIN_EMAIL, ADMIN_PASSWORD (12+ chars) and optional ADMIN_NAME from
 * the environment, so the password never appears in command-line arguments.
 * Set ADMIN_PROMOTE_EXISTING=true to promote an existing account instead.
 *
 *   npm run admin:create
 *   docker compose run --rm -e ADMIN_EMAIL -e ADMIN_PASSWORD migrate npm run admin:create
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { isAppError } from "../src/lib/errors";
import { bootstrapAdminAccount } from "../src/server/services/staff-service";

async function main() {
  const email = process.env.ADMIN_EMAIL ?? "";
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email || !password) {
    console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters) in the environment, then run again.");
    process.exitCode = 1;
    return;
  }
  const result = await bootstrapAdminAccount({
    email,
    password,
    name: process.env.ADMIN_NAME ?? "Administrator",
    promoteExisting: process.env.ADMIN_PROMOTE_EXISTING === "true",
  });
  console.log(
    result.created ? `Administrator ${email.toLowerCase()} created.` : `Existing account ${email.toLowerCase()} promoted to administrator.`,
  );
}

main()
  .catch((error) => {
    console.error(isAppError(error) ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
