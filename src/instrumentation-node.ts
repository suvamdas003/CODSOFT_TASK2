
import { validateServerEnv } from "@/lib/env";

export function validateProductionConfiguration(): void {
  const problems = validateServerEnv(process.env);

  if (problems.length === 0) {
    return;
  }

  const message = [
    "DineDesk configuration problems:",
    ...problems.map((problem) => `- ${problem}`),
  ].join("\n");

  if (process.env.NODE_ENV === "production") {
    console.error(
      `${message}\nRefusing to start. Fix the settings above (see docs/DEPLOYMENT.md).`,
    );

    process.exit(1);
  }

  console.warn(message);
}
