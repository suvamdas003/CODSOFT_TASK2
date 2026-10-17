import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { trustedProxyCidrs } from "@/lib/client-ip";
import { prisma } from "@/lib/db";
import { rateLimitingDisabled, shouldUseSecureCookies } from "@/lib/env";

function trustedOrigins(): string[] {
  const origins = [process.env.BETTER_AUTH_URL, process.env.APP_URL];
  for (const origin of (process.env.TRUSTED_ORIGINS ?? "").split(",")) origins.push(origin.trim());
  return [...new Set(origins.filter((origin): origin is string => Boolean(origin)))];
}

/**
 * Better Auth server instance.
 * - Email/password accounts, password hashing (scrypt) handled by Better Auth.
 * - HttpOnly, SameSite=Lax session cookies; Secure whenever the site is served over HTTPS.
 * - Origin checks protect auth endpoints from CSRF.
 * - Login/sign-up rate limits stored in the database, keyed by the client IP that
 *   the trusted reverse proxy writes into X-Forwarded-For (see docs/SECURITY.md).
 * - `role` and `isActive` can never be set by a client (input: false).
 */
function createAuth() {
  return betterAuth({
    appName: "DineDesk",
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    trustedOrigins: trustedOrigins(),
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    user: {
      additionalFields: {
        role: { type: "string", required: false, defaultValue: "CUSTOMER", input: false },
        isActive: { type: "boolean", required: false, defaultValue: true, input: false },
      },
    },
    rateLimit: {
      enabled: !rateLimitingDisabled("auth"),
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60 * 60, max: 10 },
      },
    },
    advanced: {
      useSecureCookies: shouldUseSecureCookies(),
      ipAddress: {
        ipAddressHeaders: ["x-forwarded-for"],
        trustedProxies: trustedProxyCidrs(),
      },
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },
    databaseHooks: {
      session: {
        create: {
          // Deactivated accounts cannot start new sessions.
          before: async (session) => {
            const user = await prisma.user.findUnique({
              where: { id: session.userId },
              select: { isActive: true },
            });
            if (!user?.isActive) return false;
          },
        },
      },
    },
    telemetry: { enabled: false },
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;

/**
 * The Better Auth instance, created on first use. Creating it lazily keeps
 * `next build` (which imports route modules to collect page data) from
 * initialising authentication without runtime secrets.
 */
export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}
