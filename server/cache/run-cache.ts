import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import Redis from "ioredis";
import type { InsertAnalysis } from "@shared/schema";

const redisOpts = { maxRetriesPerRequest: null, enableReadyCheck: false } as const;

let _redis: Redis | null = null;

function getRedis(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!_redis) _redis = new Redis(url, { ...redisOpts });
  return _redis;
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "__pycache__",
  ".venv",
  "venv",
  "dist",
  "build",
  ".next",
  ".turbo",
]);

/**
 * Walk files under localPath; hash sorted (relPath + size + mtime) — no reads, stat only.
 */
export async function computeContentHash(localPath: string): Promise<string> {
  const entries: { rel: string; size: number; mtime: number }[] = [];

  async function walk(dir: string, relPrefix: string): Promise<void> {
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (SKIP_DIRS.has(name)) continue;
      const abs = path.join(dir, name);
      const rel = relPrefix ? `${relPrefix}/${name}` : name;
      let st;
      try {
        st = await fs.lstat(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        await walk(abs, rel);
      } else if (st.isFile()) {
        entries.push({ rel, size: st.size, mtime: Math.trunc(st.mtimeMs) });
      }
    }
  }

  await walk(localPath, "");
  entries.sort((a, b) => a.rel.localeCompare(b.rel));
  const h = createHash("sha256");
  for (const e of entries) {
    h.update(e.rel);
    h.update("\0");
    h.update(String(e.size));
    h.update("\0");
    h.update(String(e.mtime));
    h.update("\n");
  }
  return h.digest("hex");
}

export type CachedRun = {
  dossier: string;
  claims: unknown;
  howto: unknown;
  operate: unknown;
  coverage: unknown;
  unknowns: unknown;
  dependencyGraph: unknown | null;
  apiSurface: unknown | null;
  learnerReport: string | null;
  receiptHash: string | null;
  runDir: string;
  dciScore: number | null;
  claimCount: number | null;
  verifiedCount: number | null;
  openEndpointCount: number | null;
  criticalIssueCount: number | null;
  dependencyCount: number | null;
  flaggedDependencyCount: number | null;
};

const TTL_SEC = 86_400;

export async function getCachedRun(contentHash: string): Promise<CachedRun | null> {
  const r = getRedis();
  if (!r) return null;
  const raw = await r.get(`run:cache:${contentHash}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedRun;
  } catch {
    return null;
  }
}

export async function setCachedRun(contentHash: string, run: CachedRun): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.setex(`run:cache:${contentHash}`, TTL_SEC, JSON.stringify(run));
}

/** Build cache payload from post-analyzer artifacts + DB insert shape. */
export function buildCachedRunFromArtifacts(opts: {
  insertPayload: Omit<InsertAnalysis, "projectId">;
  receiptHash: string | null;
  runDir: string;
  metrics: {
    dciScore: number | null;
    claimCount: number | null;
    verifiedCount: number | null;
    openEndpointCount: number | null;
    criticalIssueCount: number | null;
    dependencyCount: number | null;
    flaggedDependencyCount: number | null;
  };
}): CachedRun {
  const p = opts.insertPayload;
  return {
    dossier: p.dossier ?? "",
    claims: p.claims ?? {},
    howto: p.howto ?? {},
    operate: p.operate ?? {},
    coverage: p.coverage ?? {},
    unknowns: p.unknowns ?? [],
    dependencyGraph: p.dependencyGraph ?? null,
    apiSurface: p.apiSurface ?? null,
    learnerReport: p.learnerReport ?? null,
    receiptHash: opts.receiptHash,
    runDir: opts.runDir,
    ...opts.metrics,
  };
}
