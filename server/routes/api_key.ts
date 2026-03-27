/**
 * User-scoped API keys (parity with credits) — implement persistence + hashing here.
 * Future: POST /api/api-keys, GET list, revoke; keys map to user_id for runner auth.
 */

export type ApiKeyRecord = {
  id: string;
  userId: number;
  label: string;
  createdAt: string;
};
