import Stripe from "stripe";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!_stripe) {
    _stripe = new Stripe(key);
  }
  return _stripe;
}

export const CREDIT_COSTS = {
  learner: 1,
  pro: 5,
  audio_only: 1,
  surface_scan: 1,
} as const;

function buildCreditPacks(): Record<string, number> {
  const m: Record<string, number> = {};
  const e = process.env;
  if (e.STRIPE_PRICE_STARTER) m[e.STRIPE_PRICE_STARTER] = 10;
  if (e.STRIPE_PRICE_BUILDER) m[e.STRIPE_PRICE_BUILDER] = 50;
  if (e.STRIPE_PRICE_STUDIO) m[e.STRIPE_PRICE_STUDIO] = 200;
  if (e.STRIPE_PRICE_UNLIMITED) m[e.STRIPE_PRICE_UNLIMITED] = 999;
  return m;
}

export const CREDIT_PACKS: Record<string, number> = buildCreditPacks();

/** When `DEBRIEF_BILLING_ACTIVE=1`, credit checks deduct and enforce balance. */
export const BILLING_ACTIVE = process.env.DEBRIEF_BILLING_ACTIVE === "1";

export function appOrigin(): string {
  return (process.env.APP_URL || "http://localhost:5000").replace(/\/$/, "");
}
