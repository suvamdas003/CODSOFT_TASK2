import { redirect } from "next/navigation";
import { homePathForRole } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";

/** Sends a freshly signed-in user to the right home for their role. */
export default async function PostLoginPage() {
  const user = await getCurrentUser();
  redirect(user ? homePathForRole(user.role) : "/login");
}
