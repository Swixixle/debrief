import type { User } from "@shared/schema";

declare global {
  namespace Express {
    interface Request {
      /** Populated by `apiKeyAuth` when `Authorization: Bearer dk_...` is valid. */
      apiUser?: User;
    }
  }
}

export {};
