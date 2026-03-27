/**
 * Clerk — install @clerk/clerk-sdk-node and set CLERK_SECRET_KEY to enable.
 * Middleware hooks land once every route is scoped to an authenticated user.
 */
export function isClerkConfigured(): boolean {
  return Boolean(process.env.CLERK_SECRET_KEY?.length);
}
