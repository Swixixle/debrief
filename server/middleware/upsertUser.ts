import type { RequestHandler } from "express";
import { db } from "../db";
import { users } from "@shared/schema";
import { clerkEnabled, getAuth } from "./clerk";

/** Ensure a `users` row exists on first authenticated Clerk request. */
export const upsertUserMiddleware: RequestHandler = async (req, _res, next) => {
  if (!clerkEnabled) return next();
  try {
    const auth = getAuth(req);
    const userId = auth.userId;
    if (!userId) return next();

    await db
      .insert(users)
      .values({
        clerkUserId: userId,
        creditsRemaining: 999_999,
        tier: "free",
      })
      .onConflictDoNothing({ target: users.clerkUserId });
  } catch (err) {
    console.error("upsertUserMiddleware:", err);
  }
  next();
};
