import { jsonError, jsonOk } from "@/lib/api";
import { getActor } from "@/lib/auth/session";
import { listKitchenOrders } from "@/server/services/order-service";

/** Polled by the kitchen display. Kitchen staff and admins only. */
export async function GET() {
  try {
    const actor = await getActor(["KITCHEN_STAFF", "ADMIN"]);
    const orders = await listKitchenOrders(actor);
    return jsonOk({ serverTime: new Date().toISOString(), orders });
  } catch (error) {
    return jsonError(error, { route: "GET /api/kitchen/orders" });
  }
}
