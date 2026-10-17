import { parseInput } from "@/lib/action";
import { jsonError, jsonOk } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth/session";
import { UnauthorizedError } from "@/lib/errors";
import { idSchema } from "@/lib/validation/common";
import { getOrderForActor } from "@/server/services/order-service";

/** Lightweight status endpoint polled by the order tracking page. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new UnauthorizedError();
    const { id } = await params;
    const order = await getOrderForActor(user, parseInput(idSchema, id));
    return jsonOk({
      id: order.id,
      status: order.status,
      paymentStatus: order.paymentStatus,
      updatedAt: order.updatedAt.toISOString(),
    });
  } catch (error) {
    return jsonError(error, { route: "GET /api/orders/[id]" });
  }
}
