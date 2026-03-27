import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db";
import { creditTransactions, users } from "@shared/schema";
import { BILLING_ACTIVE, getStripe, appOrigin, CREDIT_PACKS } from "./stripe";

export type CreditCheckResult = { ok: true } | { ok: false; checkoutUrl?: string };

export async function checkCredits(
  clerkUserId: string | null | undefined,
  cost: number,
): Promise<CreditCheckResult> {
  if (!BILLING_ACTIVE) return { ok: true };

  if (!clerkUserId) {
    // Anonymous — extend with Redis session when billing goes live
    return { ok: true };
  }

  const result = await db
    .update(users)
    .set({
      creditsRemaining: sql`${users.creditsRemaining} - ${cost}`,
    })
    .where(and(eq(users.clerkUserId, clerkUserId), gte(users.creditsRemaining, cost)))
    .returning({ id: users.id });

  if (result.length === 0) {
    const url = await createCheckoutUrl(clerkUserId);
    return { ok: false, checkoutUrl: url };
  }

  await db.insert(creditTransactions).values({
    userId: result[0].id,
    amount: -cost,
    type: "use",
  });

  return { ok: true };
}

export async function refundCredits(clerkUserId: string | null | undefined, cost: number): Promise<void> {
  if (!BILLING_ACTIVE || !clerkUserId || cost <= 0) return;

  const row = await db.query.users.findFirst({
    where: eq(users.clerkUserId, clerkUserId),
  });
  if (!row) return;

  await db
    .update(users)
    .set({
      creditsRemaining: sql`${users.creditsRemaining} + ${cost}`,
    })
    .where(eq(users.id, row.id));

  await db.insert(creditTransactions).values({
    userId: row.id,
    amount: cost,
    type: "refund",
  });
}

async function createCheckoutUrl(clerkUserId: string): Promise<string | undefined> {
  const stripe = getStripe();
  const priceId = process.env.STRIPE_PRICE_STARTER;
  if (!stripe || !priceId) return undefined;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appOrigin()}/billing/success`,
    cancel_url: `${appOrigin()}/billing`,
    metadata: { clerkUserId },
    client_reference_id: clerkUserId,
  });
  return session.url ?? undefined;
}
