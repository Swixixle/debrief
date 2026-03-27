/**
 * Detect hosted git URLs that should be cloned locally before analysis.
 * Extend with new matchers (GitLab, Bitbucket, etc.) without changing call sites.
 */

export type CloneAnalyzeKind = "replit";

export interface CloneAnalyzeMatch {
  kind: CloneAnalyzeKind;
  /** Normalized HTTPS git clone URL */
  cloneUrl: string;
  /** Short display label */
  label: string;
}

const REPLIT_PATH = /^\/@([^/]+)\/([^/]+?)(?:\.git)?\/?$/i;

/** Normalize user paste (optional scheme) to an absolute URL string. */
export function normalizeHttpUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

/**
 * If the input is a Replit repl URL, return canonical `https.replit.com/@user/repo.git`.
 * Other providers: add parallel matchers and union the result type later.
 */
export function matchCloneAnalyzeUrl(raw: string): CloneAnalyzeMatch | null {
  const withScheme = normalizeHttpUrl(raw);
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./i, "").toLowerCase();
  if (!host.endsWith("replit.com")) return null;

  const m = u.pathname.match(REPLIT_PATH);
  if (!m) return null;
  const user = m[1];
  let repl = m[2];
  repl = repl.replace(/\.git$/i, "");
  if (!user || !repl) return null;

  return {
    kind: "replit",
    cloneUrl: `https://replit.com/@${user}/${repl}.git`,
    label: `@${user}/${repl}`,
  };
}
