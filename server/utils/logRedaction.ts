/** Strip control / line-break characters that confuse log aggregators (log injection). */
export function redactForLog(input: string, maxChars = 16_000): string {
  return input
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "␤")
    .slice(0, maxChars);
}

/** GitHub delivery UUID (x-github-delivery) — allowlist only. */
export function safeGithubDeliveryId(value: unknown): string {
  const s = String(value ?? "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : "?";
}

/** GitHub owner or repo name segment. */
export function safeGithubSlug(value: unknown): string {
  const s = String(value ?? "").slice(0, 140);
  return /^[a-zA-Z0-9._-]+$/.test(s) ? s : "?";
}

/** Git commit SHA (short or full). */
export function safeGitCommitSha(value: unknown): string {
  const s = String(value ?? "");
  return /^[0-9a-f]{7,40}$/i.test(s) ? s.slice(0, 40) : "?";
}

/** Branch / ref name for CI logs (conservative). */
export function safeGitRef(value: unknown): string {
  const s = String(value ?? "").slice(0, 260);
  const t = s.replace(/[^a-zA-Z0-9._/-]/g, "");
  return t.length > 0 ? t : "?";
}

export function safePositiveIntId(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) return "?";
  return String(Math.trunc(n));
}
