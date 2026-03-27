import type { Express, Request, Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { apiKeys, users } from "@shared/schema";
import { generateApiKey } from "../auth/api-keys";
import { getAuth, requireClerkSession } from "../middleware/clerk";

const bodySchema = z.object({
  label: z.string().min(1, "label is required").max(200),
});

export function mountApiKeyRoutes(app: Express): void {
  app.post("/api/keys", requireClerkSession, async (req: Request, res: Response) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid body" });
    }
    const { label } = parsed.data;
    const auth = getAuth(req);
    const clerkId = auth.userId!;
    await db
      .insert(users)
      .values({
        clerkUserId: clerkId,
        creditsRemaining: 999_999,
        tier: "free",
      })
      .onConflictDoNothing({ target: users.clerkUserId });

    const user = await db.query.users.findFirst({
      where: eq(users.clerkUserId, clerkId),
    });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const { key, hash, prefix } = generateApiKey();
    await db.insert(apiKeys).values({
      userId: user.id,
      keyHash: hash,
      keyPrefix: prefix,
      label,
    });

    res.json({ key, prefix, label });
  });

  app.get("/api/keys", requireClerkSession, async (req: Request, res: Response) => {
    const auth = getAuth(req);
    const clerkId = auth.userId!;
    const user = await db.query.users.findFirst({
      where: eq(users.clerkUserId, clerkId),
    });
    if (!user) {
      return res.json([]);
    }
    const keys = await db.query.apiKeys.findMany({
      where: and(eq(apiKeys.userId, user.id), isNull(apiKeys.revokedAt)),
      columns: {
        id: true,
        keyPrefix: true,
        label: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });
    res.json(keys);
  });

  app.delete("/api/keys/:id", requireClerkSession, async (req: Request, res: Response) => {
    const auth = getAuth(req);
    const clerkId = auth.userId!;
    const user = await db.query.users.findFirst({
      where: eq(users.clerkUserId, clerkId),
    });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, user.id)));
    res.json({ revoked: true });
  });
}
