import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/display";
import { RegisterForm } from "@/features/auth/auth-forms";
import { homePathForRole } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { firstParam } from "@/lib/utils";
import { safeNextPath } from "@/lib/validation/auth";

export const metadata: Metadata = { title: "Create account" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const next = safeNextPath(firstParam((await searchParams).next)) ?? undefined;
  const user = await getCurrentUser();
  if (user) redirect(next ?? homePathForRole(user.role));
  return (
    <Card className="p-6 sm:p-8">
      <h1 className="font-display text-2xl font-semibold text-stone-900">Create your account</h1>
      <p className="mt-1 mb-6 text-sm text-stone-600">Order online, save your order history and manage reservations.</p>
      <RegisterForm next={next} />
    </Card>
  );
}
