/** Real Clerk publishable key for this build, or `undefined` if auth UI should stay off. */
export function clerkPublishableKey(): string | undefined {
  const raw = String(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? "").trim();
  if (!raw) return undefined;
  // Docs / example placeholders (truthy but invalid for Clerk)
  if (raw.includes("...")) return undefined;
  if (!raw.startsWith("pk_test_") && !raw.startsWith("pk_live_")) return undefined;
  return raw;
}

export function isClerkConfigured(): boolean {
  return clerkPublishableKey() !== undefined;
}
