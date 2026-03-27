/**
 * Stripe client for Debrief credits (checkout + webhooks wired in a follow-up).
 */
import Stripe from "stripe";

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

export function stripeWebhookMiddlewareRawBody(): boolean {
  return true;
}
