import type { Metadata } from "next";
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui/display";
import { DiscountForm, DiscountToggle } from "@/features/admin/forms";
import { ADMIN_ROLES } from "@/lib/auth/permissions";
import { requireRole } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import { getSettings } from "@/server/repositories/settings-repository";
import { listDiscounts } from "@/server/services/discount-service";

export const metadata: Metadata = { title: "Discounts" };

export default async function DiscountsPage() {
  await requireRole(ADMIN_ROLES, "/admin/discounts");
  const [discounts, settings] = await Promise.all([listDiscounts(), getSettings()]);
  const money = (minor: number) => formatMoney(minor, settings.currency, settings.locale);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Discount codes"
        description="Codes are validated and redeemed on the server at checkout; usage limits are enforced atomically."
      />
      <Card>
        <CardHeader title="Create a code" />
        <CardBody>
          <DiscountForm currency={settings.currency} />
        </CardBody>
      </Card>
      {discounts.length === 0 ? (
        <EmptyState title="No discount codes yet" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Discount</Th>
              <Th>Conditions</Th>
              <Th>Used</Th>
              <Th>Status</Th>
              <Th className="text-right">Action</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {discounts.map((discount) => (
              <tr key={discount.id}>
                <Td>
                  <span className="font-mono font-semibold">{discount.code}</span>
                  {discount.description ? <p className="text-xs text-stone-500">{discount.description}</p> : null}
                </Td>
                <Td>{discount.type === "PERCENT" ? `${discount.value / 100}%` : money(discount.value)}</Td>
                <Td className="text-xs text-stone-600">
                  {discount.minSubtotalMinor ? <p>Min. order {money(discount.minSubtotalMinor)}</p> : null}
                  {discount.maxDiscountMinor !== null ? <p>Max. {money(discount.maxDiscountMinor)}</p> : null}
                  {discount.startsAt ? <p>From {formatDateTime(discount.startsAt, settings.timezone, settings.locale)}</p> : null}
                  {discount.endsAt ? <p>Until {formatDateTime(discount.endsAt, settings.timezone, settings.locale)}</p> : null}
                </Td>
                <Td>
                  {discount.redemptionCount}
                  {discount.maxRedemptions !== null ? ` / ${discount.maxRedemptions}` : ""}
                </Td>
                <Td>{discount.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</Td>
                <Td className="text-right">
                  <DiscountToggle id={discount.id} isActive={discount.isActive} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
