import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { getAuth, requireClerkSession } from "../middleware/clerk";
import { db } from "../db";
import { users } from "@shared/schema";
import { BILLING_ACTIVE, getStripe, appOrigin, CREDIT_PACKS } from "./stripe";

const billingRateOk = () => true;

export function mountBillingRoutes(app: Express): void {
  app.get("/api/billing/credits", async (req: Request, res: Response) => {
    if (!billingRateOk()) return res.status(429).json({ error: "Rate limit exceeded" });
    try {
      const auth = getAuth(req);
      const userId = auth.userId;
      if (!userId) {
        return res.json({
          creditsRemaining: 999_999,
          tier: "free",
          billingActive: BILLING_ACTIVE,
        });
      }
      const user = await db.query.users.findFirst({
        where: eq(users.clerkUserId, userId),
      });
      res.json({
        creditsRemaining: user?.creditsRemaining ?? 999_999,
        tier: user?.tier ?? "free",
        billingActive: BILLING_ACTIVE,
      });
    } catch {
      res.status(500).json({ message: "Failed to load credits" });
    }
  });

  app.get("/api/billing/products", async (_req: Request, res: Response) => {
    const stripe = getStripe();
    if (!stripe) {
      return res.json({ active: BILLING_ACTIVE, products: [] as unknown[] });
    }
    try {
      const prices = await stripe.prices.list({ active: true, expand: ["data.product"], limit: 20 });
      res.json({
        active: BILLING_ACTIVE,
        products: prices.data.map((p) => ({
          priceId: p.id,
          amount: p.unit_amount,
          currency: p.currency,
          interval: p.recurring?.interval ?? null,
          credits: CREDIT_PACKS[p.id] ?? null,
        })),
      });
    } catch (e) {
      console.error("stripe prices list:", e);
      res.json({ active: BILLING_ACTIVE, products: [] });
    }
  });

  app.post("/api/billing/checkout", requireClerkSession, async (req: Request, res: Response) => {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({ error: "Stripe is not configured" });
    }
    const priceId = String((req.body as { priceId?: string })?.priceId || "");
    if (!priceId) {
      return res.status(400).json({ error: "priceId required" });
    }

    const auth = getAuth(req);
    const clerkUserId = auth.userId!;

    const unlimitedPrice = process.env.STRIPE_PRICE_UNLIMITED;
    const mode = unlimitedPrice && priceId === unlimitedPrice ? "subscription" : "payment";

    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appOrigin()}/billing/success`,
      cancel_url: `${appOrigin()}/billing`,
      metadata: { clerkUserId },
      client_reference_id: clerkUserId,
    });

    res.json({ url: session.url });
  });
}
