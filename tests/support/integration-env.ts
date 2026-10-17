import { afterAll } from "vitest";
import { resolveTestDatabaseUrl } from "./test-database";

// Must run before the lazily-created Prisma client is first used.
process.env.DATABASE_URL = resolveTestDatabaseUrl();
process.env.STRIPE_SECRET_KEY = "";
process.env.STRIPE_WEBHOOK_SECRET = "";

afterAll(async () => {
  const { prisma } = await import("@/lib/db");
  await prisma.$disconnect();
});
