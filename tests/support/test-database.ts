import { config } from "dotenv";

/**
 * Resolves the integration-test database URL and refuses to run against
 * anything that looks like the development or a production database.
 */
export function resolveTestDatabaseUrl(): string {
  config({ quiet: true });
  const url = process.env.DATABASE_URL_TEST;
  if (!url) {
    throw new Error("DATABASE_URL_TEST is not set. Add it to .env (see .env.example) to run integration tests.");
  }
  const databaseName = new URL(url).pathname.replace(/^\//, "");
  if (!/test/i.test(databaseName)) {
    throw new Error(`Refusing to run integration tests: database "${databaseName}" does not contain "test" in its name.`);
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) {
    throw new Error("Refusing to run integration tests: DATABASE_URL_TEST must differ from DATABASE_URL.");
  }
  return url;
}
