import type { Request, Response } from "express";
import Stripe from "stripe";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { creditTransactions, users } from "@shared/schema";
import { BILLING_ACTIVE, CREDIT_PACKS, getStripe } from "./stripe";

export async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    res.status(503).send("Billing not configured");
    return;
  }

  const sig = req.headers["stripe-signature"];
  if (!sig || typeof sig !== "string") {
    res.status(400).send("Missing stripe-signature");
    return;
  }

  const buf = req.body instanceof Buffer ? req.body : Buffer.from(JSON.stringify(req.body));

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, secret);
  } catch {
    res.status(400).send("Webhook signature invalid");
    return;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const clerkUserId =
      (session.metadata?.clerkUserId as string | undefined) || session.client_reference_id || undefined;

    let priceId: string | undefined;
    let credits = 0;
    try {
      const full = await stripe.checkout.sessions.retrieve(session.id, {
        expand: ["line_items.data.price"],
      });
      const li = full.line_items?.data?.[0];
      const p = li?.price;
      priceId = typeof p === "string" ? p : p?.id;
      if (priceId) credits = CREDIT_PACKS[priceId] ?? 0;
    } catch (e) {
      console.error("stripe webhook retrieve session:", e);
    }

    if (clerkUserId && credits > 0) {
      await db
        .update(users)
        .set({
          creditsRemaining: sql`${users.creditsRemaining} + ${credits}`,
        })
        .where(eq(users.clerkUserId, clerkUserId));

      const u = await db.query.users.findFirst({
        where: eq(users.clerkUserId, clerkUserId),
      });
      if (u) {
        const pi =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent && "id" in session.payment_intent
              ? (session.payment_intent as Stripe.PaymentIntent).id
              : null;
        await db.insert(creditTransactions).values({
          userId: u.id,
          amount: credits,
          type: "purchase",
          stripePaymentIntentId: pi ?? undefined,
        });
      }
    }
  }

  if (!BILLING_ACTIVE) {
    /* still record purchases when webhook fires; enforcement is separate */
  }

  res.json({ received: true });
}
