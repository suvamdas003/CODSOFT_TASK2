/**
 * Startup validation of security-relevant configuration. In production a
 * misconfiguration stops the server instead of running with unsafe defaults
 * (see src/instrumentation.ts); elsewhere problems are logged as warnings.
 */
const PLACEHOLDER_HINTS = ["replace", "change-me", "changeme", "example", "placeholder", "your-secret"];

export function validateServerEnv(env: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  const production = env.NODE_ENV === "production";

  if (!env.DATABASE_URL) problems.push("DATABASE_URL is not set.");

  const secret = env.BETTER_AUTH_SECRET ?? "";
  if (!secret) {
    problems.push("BETTER_AUTH_SECRET is not set.");
  } else if (secret.length < 32) {
    problems.push("BETTER_AUTH_SECRET must be at least 32 characters (generate one with `npm run env:init`).");
  } else if (PLACEHOLDER_HINTS.some((hint) => secret.toLowerCase().includes(hint))) {
    problems.push("BETTER_AUTH_SECRET still contains the placeholder from .env.example; generate a random secret.");
  }

  const baseUrl = env.BETTER_AUTH_URL;
  if (!baseUrl) {
    problems.push("BETTER_AUTH_URL is not set (it must be the public URL users open, e.g. https://dinedesk.example.com).");
  } else {
    try {
      const url = new URL(baseUrl);
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      if (production && url.protocol !== "https:" && !local) {
        problems.push("BETTER_AUTH_URL must use https:// in production (plain HTTP is only allowed for localhost).");
      }
    } catch {
      problems.push("BETTER_AUTH_URL is not a valid URL.");
    }
  }

  if (Boolean(env.STRIPE_SECRET_KEY) !== Boolean(env.STRIPE_WEBHOOK_SECRET)) {
    problems.push("Set both STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET, or neither.");
  }

  if (production && (env.AUTH_RATE_LIMIT_ENABLED === "false" || env.APP_RATE_LIMIT_DISABLED === "true")) {
    problems.push("Rate limiting cannot be disabled in production; remove AUTH_RATE_LIMIT_ENABLED/APP_RATE_LIMIT_DISABLED.");
  }

  return problems;
}

/** Rate-limit kill switches are honoured only outside production (local debugging). */
export function rateLimitingDisabled(kind: "auth" | "app", env: Record<string, string | undefined> = process.env): boolean {
  if (env.NODE_ENV === "production") return false;
  return kind === "auth" ? env.AUTH_RATE_LIMIT_ENABLED === "false" : env.APP_RATE_LIMIT_DISABLED === "true";
}

/** Session cookies are marked Secure whenever the public URL is HTTPS. */
export function shouldUseSecureCookies(baseUrl = process.env.BETTER_AUTH_URL): boolean {
  return (baseUrl ?? "").toLowerCase().startsWith("https://");
}
