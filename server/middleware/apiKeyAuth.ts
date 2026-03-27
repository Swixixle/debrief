import type { RequestHandler } from "express";
import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { apiKeys } from "@shared/schema";

/** Resolve `Bearer dk_...` before Clerk. Calls `next()` when header is absent or not a Debrief key. */
export const apiKeyAuth: RequestHandler = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer dk_")) {
    return next();
  }

  const key = authHeader.slice("Bearer ".length).trim();
  const hash = createHash("sha256").update(key, "utf8").digest("hex");

  const record = await db.query.apiKeys.findFirst({
    where: and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)),
    with: { user: true },
  });

  if (!record?.user) {
    return res.status(401).json({ error: "Invalid API key" });
  }

  void db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, record.id))
    .catch(() => {});

  req.apiUser = record.user;
  next();
};
