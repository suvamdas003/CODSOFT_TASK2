import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { config } from "dotenv";

// Empties every application table (keeps the migration history) in one statement.
const TRUNCATE_ALL = `DO $$
DECLARE stmt text;
BEGIN
  SELECT 'TRUNCATE TABLE ' || string_agg(format('%I.%I', schemaname, tablename), ', ') || ' RESTART IDENTITY CASCADE'
    INTO stmt
    FROM pg_tables
   WHERE schemaname = 'public' AND tablename <> '_prisma_migrations';
  IF stmt IS NOT NULL THEN EXECUTE stmt; END IF;
END $$;`;

/**
 * Prepares the disposable end-to-end database: applies migrations, wipes all
 * data (including auth rate-limit buckets and sessions) and loads the demo seed.
 */
export default async function globalSetup() {
  config({ quiet: true });
  const url = process.env.DATABASE_URL_E2E;
  if (!url) throw new Error("DATABASE_URL_E2E is not set. Add it to .env (see .env.example) to run end-to-end tests.");
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!/e2e/i.test(name) || url === process.env.DATABASE_URL || url === process.env.DATABASE_URL_TEST) {
    throw new Error(`Refusing to reset "${name}": the E2E database name must contain "e2e" and differ from the dev and test databases.`);
  }

  const env = { ...process.env, DATABASE_URL: url };
  execSync("npx prisma migrate deploy", { stdio: "pipe", env });
  execSync("npx prisma db execute --stdin", { input: TRUNCATE_ALL, stdio: ["pipe", "pipe", "pipe"], env });
  execSync("npx tsx prisma/seed.ts", { stdio: "pipe", env });
  // Saved sessions belong to the previous database; force fresh sign-ins.
  rmSync("tests/e2e/.auth", { recursive: true, force: true });
}
