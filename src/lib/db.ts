import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/generated/prisma/client";

export { Prisma };

/** Transaction client type accepted by services that may run inside a transaction. */
export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and configure it.");
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

const globalForPrisma = globalThis as unknown as { __dinedeskPrisma?: PrismaClient };

/**
 * Lazily-created Prisma client. A single instance is reused across hot reloads
 * in development to avoid exhausting database connections.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    if (!globalForPrisma.__dinedeskPrisma) {
      globalForPrisma.__dinedeskPrisma = createPrismaClient();
    }
    const client = globalForPrisma.__dinedeskPrisma;
    const value = Reflect.get(client, property, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

/** Postgres/Prisma error helpers. */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Detects a violated PostgreSQL exclusion constraint (SQLSTATE 23P01), which
 * we use to forbid overlapping reservations on the same table.
 */
export function isExclusionViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const text = JSON.stringify(error, Object.getOwnPropertyNames(error));
  return text.includes("23P01") || text.includes("reservations_no_overlap");
}
