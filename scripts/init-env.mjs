/**
 * Creates local environment files with freshly generated secrets.
 *
 *   node scripts/init-env.mjs              → .env (local development)
 *   node scripts/init-env.mjs --production → .env.production (Docker stack)
 *
 * Existing files are never overwritten; only placeholder values in them are
 * replaced. Secrets are written to disk only, never printed.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const production = process.argv.includes("--production");
const target = production ? ".env.production" : ".env";
const template = production ? ".env.production.example" : ".env.example";

const secret = () => randomBytes(32).toString("base64url");
// URL-safe so it can be embedded in DATABASE_URL without escaping.
const dbPassword = () => randomBytes(24).toString("base64url");

const SECRET_PLACEHOLDER = "replace-with-a-long-random-secret-at-least-32-chars";
const DB_PLACEHOLDER = "replace-with-a-strong-database-password";

const created = !existsSync(target);
let content = readFileSync(created ? template : target, "utf8");
const changes = [];

if (content.includes(SECRET_PLACEHOLDER)) {
  content = content.replaceAll(SECRET_PLACEHOLDER, secret());
  changes.push("BETTER_AUTH_SECRET");
}
if (content.includes(DB_PLACEHOLDER)) {
  content = content.replaceAll(DB_PLACEHOLDER, dbPassword());
  changes.push("POSTGRES_PASSWORD/DATABASE_URL");
}

if (created || changes.length) writeFileSync(target, content, { encoding: "utf8", mode: 0o600 });
console.log(
  `${created ? "Created" : "Checked"} ${target}${changes.length ? ` — generated ${changes.join(", ")}` : " — no placeholders left to replace"}.`,
);
