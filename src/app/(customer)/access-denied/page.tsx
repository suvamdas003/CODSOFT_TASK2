import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/display";

export const metadata: Metadata = { title: "Access denied" };

export default function AccessDeniedPage() {
  return (
    <EmptyState
      title="You don't have access to that page"
      description="Your account role does not include this area. If you think this is a mistake, ask a DineDesk administrator."
      action={
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          Go to the home page
        </Link>
      }
    />
  );
}
