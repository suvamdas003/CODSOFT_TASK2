import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/display";
import { CartView } from "@/features/cart/cart-view";
import { getCurrentUser } from "@/lib/auth/session";
import { getOnlinePaymentProvider, isStripeTestMode } from "@/server/payments";
import { getSettings, toPublicSettings } from "@/server/repositories/settings-repository";
import { listActiveTablesForDineIn } from "@/server/services/table-service";

export const metadata: Metadata = { title: "Cart & checkout" };

export default async function CartPage() {
  const [user, settings, tables] = await Promise.all([getCurrentUser(), getSettings(), listActiveTablesForDineIn()]);
  const onlineConfigured = Boolean(getOnlinePaymentProvider());
  const paymentMethods = settings.enabledPaymentMethods.filter((method) => method !== "ONLINE_CARD" || onlineConfigured);

  return (
    <div>
      <PageHeader title="Your cart" description="Review your items, then choose how you'd like to receive and pay for your order." />
      <CartView
        settings={toPublicSettings(settings)}
        paymentMethods={paymentMethods}
        onlineTestMode={onlineConfigured && isStripeTestMode()}
        tables={tables}
        user={user ? { name: user.name, role: user.role } : null}
      />
    </div>
  );
}
