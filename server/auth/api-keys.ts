import { createHash, randomBytes } from "node:crypto";

export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const raw = randomBytes(32).toString("base64url");
  const key = `dk_${raw}`;
  const hash = createHash("sha256").update(key, "utf8").digest("hex");
  const prefix = key.slice(0, 10);
  return { key, hash, prefix };
}
