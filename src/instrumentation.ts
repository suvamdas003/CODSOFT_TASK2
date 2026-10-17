
/**
 * Runs once when the Next.js server starts.
 * Node.js-specific validation is delegated to a separate module.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { validateProductionConfiguration } = await import(
    "./instrumentation-node"
  );

  validateProductionConfiguration();
}
