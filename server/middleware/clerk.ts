import type { RequestHandler } from "express";
import { clerkMiddleware, getAuth } from "@clerk/express";

export const clerkEnabled = !!process.env.CLERK_SECRET_KEY;

/** Soft auth — attaches Clerk session to request when configured. */
export const withClerk: RequestHandler = clerkEnabled
  ? clerkMiddleware()
  : (_req, _res, next) => next();

/** JSON API guard: 401 if not signed in (no redirect). */
export const requireClerkSession: RequestHandler = (req, res, next) => {
  if (!clerkEnabled) {
    return res.status(503).json({ error: "Sign-in is not configured on this server." });
  }
  const auth = getAuth(req);
  if (!auth.userId) {
    return res.status(401).json({ error: "Sign in required." });
  }
  next();
};

export { getAuth };
