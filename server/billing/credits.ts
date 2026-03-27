/**
 * Credit costs and balance checks — full atomic billing lands with users table + Stripe webhooks.
 */
export const CREDIT_COSTS = {
  learnerRun: 1,
  proRun: 5,
  audioTranscribeOnly: 1,
  urlSurfaceOnly: 1,
} as const;

export function isBillingEnforced(): boolean {
  return process.env.DEBRIEF_ENFORCE_CREDITS === "1" && process.env.NODE_ENV === "production";
}

/** Placeholder: always sufficient until Clerk + users row backs routes. */
export async function assertCreditsForRun(_userId: number | null, _cost: number): Promise<void> {
  if (!isBillingEnforced()) return;
  throw new Error("Credit enforcement is on but user billing is not wired yet — set DEBRIEF_ENFORCE_CREDITS=0");
}
