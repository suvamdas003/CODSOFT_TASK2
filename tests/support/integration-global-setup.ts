import { execSync } from "node:child_process";
import { resolveTestDatabaseUrl } from "./test-database";

/** Applies all migrations to the dedicated test database before the suite runs. */
export default function setup() {
  const url = resolveTestDatabaseUrl();
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: url },
  });
}
