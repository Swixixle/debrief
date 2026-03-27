import type { Request, RequestHandler } from "express";

/** Clerk is off until `CLERK_SECRET_KEY` (and publishable keys) are configured. */
export const clerkEnabled = false;

export const withClerk: RequestHandler = (_req, _res, next) => {
  next();
};

export const requireClerkSession: RequestHandler = (_req, _res, next) => {
  next();
};

export const requireAuth: RequestHandler = (_req, _res, next) => {
  next();
};

/** Stub while Clerk is disabled — no signed-in user. */
export function getAuth(_req: Request): { userId: string | null } {
  return { userId: null };
}
