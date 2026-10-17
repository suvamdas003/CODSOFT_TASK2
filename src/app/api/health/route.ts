import { jsonOk } from "@/lib/api";
import { prisma } from "@/lib/db";

/** Liveness/readiness probe. Reports only whether the database is reachable. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return jsonOk({ status: "ok", database: "up" });
  } catch {
    return jsonOk({ status: "degraded", database: "down" }, { status: 503 });
  }
}
