import type { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth/session";
import { clientIpFromHeaders } from "@/lib/client-ip";
import { parseInput } from "@/lib/action";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { availabilityQuerySchema } from "@/lib/validation/reservation";
import { getAvailability } from "@/server/services/reservation-service";

/**
 * Public slot availability (no personal data is returned — only times and
 * whether a table is free). Rate limited per user or client address.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const client = user?.id ?? `ip:${clientIpFromHeaders(request.headers)}`;
    enforceRateLimit(`availability:${client}`, RATE_LIMITS.availability);
    const search = request.nextUrl.searchParams;
    const query = parseInput(availabilityQuerySchema, {
      date: search.get("date") ?? "",
      partySize: search.get("partySize") ?? "",
      excludeReservationId: user ? (search.get("exclude") ?? undefined) : undefined,
    });
    return jsonOk(await getAvailability(query));
  } catch (error) {
    return jsonError(error, { route: "GET /api/reservations/availability" });
  }
}
