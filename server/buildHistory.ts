import { existsSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import type { BuildEvent, BuildHistoryPayload, CognitiveNode } from "@shared/evidenceChainModel";

function normPath(s: string): string {
  return s.replace(/\\/g, "/").replace(/^\.?\//, "").trim();
}

/**
 * Two-pass milestone → evidence node ids: exact file match, then milestone heuristics.
 * Always returns at least one id when `nodes` is non-empty (defaults to Target Repo).
 */
export function resolveHighlightIdsForEvent(ev: BuildEvent, nodes: CognitiveNode[]): string[] {
  if (!nodes.length) return [];

  const targetId = nodes.some((n) => n.id === "target") ? "target" : nodes[0]!.id;
  const filesNorm = ev.filesAdded.map((f) => normPath(f));

  const pass1 = new Set<string>();
  for (const n of nodes) {
    const ref = (n.fileRef ?? "").trim();
    if (!ref || ref === "—") continue;
    const refNorm = normPath(ref);
    for (const f of filesNorm) {
      if (!f) continue;
      if (normPath(f) === refNorm) {
        pass1.add(n.id);
      }
    }
  }

  if (pass1.size > 0) {
    return [...pass1];
  }

  const ms = ev.inferredMilestone;
  const tech = (s: string) => s.toLowerCase();
  const pass2 = new Set<string>();

  if (ms === "Project scaffolded") {
    pass2.add(targetId);
  } else if (ms === "Auth added") {
    for (const n of nodes) {
      if (/clerk|auth|passport|jwt/i.test(n.technology)) pass2.add(n.id);
    }
  } else if (ms === "Database introduced") {
    for (const n of nodes) {
      if (n.layer === "foundation") pass2.add(n.id);
    }
  } else if (ms === "API routes added") {
    for (const n of nodes) {
      if (n.shape === "up-triangle" && n.layer === "engine") pass2.add(n.id);
    }
  } else if (ms === "Background jobs added") {
    for (const n of nodes) {
      if (/queue|worker|bull|redis/i.test(tech(n.technology))) pass2.add(n.id);
    }
  } else if (ms === "Evidence chain added") {
    for (const id of ["chain-link", "receipt-creation"]) {
      if (nodes.some((n) => n.id === id)) pass2.add(id);
    }
  } else if (ms === "Deployment configured") {
    if (nodes.some((n) => n.id === "chain-export")) pass2.add("chain-export");
  }

  if (pass2.size > 0) {
    return [...pass2];
  }

  return [targetId];
}

/**
 * Attach `highlightIds` to git-derived events using the current evidence graph nodes.
 */
export function enrichBuildHistoryWithHighlightIds(
  payload: BuildHistoryPayload,
  nodes: CognitiveNode[],
): BuildHistoryPayload {
  return {
    ...payload,
    events: payload.events.map((ev) => ({
      ...ev,
      highlightIds: resolveHighlightIdsForEvent(ev, nodes),
    })),
  };
}

function runGitLog(repoPath: string): Promise<{ stdout: string; ok: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(
      "git",
      ["log", "--diff-filter=A", "--name-only", "--format=%H|%ai|%s", "--", "."],
      {
        cwd: repoPath,
        env: process.env,
      },
    );
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c) => {
      out += c;
    });
    child.stderr.on("data", (c) => {
      err += c;
    });
    child.on("error", () => resolve({ stdout: "", ok: false }));
    child.on("close", (code) => resolve({ stdout: out, ok: code === 0 }));
  });
}

function milestoneForFiles(files: string[], assigned: Set<string>): string | null {
  const lower = files.map((f) => f.replace(/\\/g, "/").toLowerCase());
  const tryAssign = (key: string, pattern: (f: string) => boolean): boolean => {
    if (assigned.has(key)) return false;
    if (!lower.some(pattern)) return false;
    assigned.add(key);
    return true;
  };

  if (tryAssign("scaffold", (f) => /(^|\/)package\.json$/.test(f) || /(^|\/)pyproject\.toml$/.test(f))) {
    return "Project scaffolded";
  }
  if (tryAssign("auth", (f) => /auth|clerk|passport/i.test(f))) {
    return "Auth added";
  }
  if (
    tryAssign(
      "db",
      (f) =>
        /(?:^|[\\/])schema(?:[\\/._]|$)/i.test(f) ||
        /(?:^|[\\/])migration(?:[\\/._]|$)/i.test(f) ||
        /\.sql$/i.test(f),
    )
  ) {
    return "Database introduced";
  }
  if (tryAssign("api", (f) => /route|api|endpoint/i.test(f))) {
    return "API routes added";
  }
  if (tryAssign("jobs", (f) => /queue|worker|bull|redis/i.test(f))) {
    return "Background jobs added";
  }
  if (tryAssign("chain", (f) => /receipt|sign|chain/i.test(f))) {
    return "Evidence chain added";
  }
  if (tryAssign("deploy", (f) => /\.env\.example$|render\.yaml|dockerfile|^docker\//i.test(f))) {
    return "Deployment configured";
  }
  return null;
}

/** @internal Exported for unit tests */
export function parseGitBlocks(raw: string): BuildEvent[] {
  const blocks = raw.split(/\n(?=[a-f0-9]{40}\|)/i).map((b) => b.trim()).filter(Boolean);
  const events: BuildEvent[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const head = lines[0] ?? "";
    const m = head.match(/^([a-f0-9]{40})\|([^|]+)\|(.*)$/i);
    if (!m) continue;
    const commitHash = m[1];
    const timestamp = m[2].trim();
    const message = m[3].trim();
    const filesAdded = lines
      .slice(1)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith(" "));
    events.push({ commitHash, timestamp, message, filesAdded, inferredMilestone: "", highlightIds: [] });
  }

  const assigned = new Set<string>();
  const withMilestones: BuildEvent[] = [];
  for (const ev of events) {
    const ms = milestoneForFiles(ev.filesAdded, assigned);
    withMilestones.push({
      ...ev,
      inferredMilestone: ms ?? "",
      highlightIds: [],
    });
  }

  return withMilestones.filter((e) => e.inferredMilestone);
}

/**
 * Infer milestone timeline from first-time file additions in git history.
 */
export async function inferBuildHistory(repoPath: string): Promise<BuildHistoryPayload> {
  if (!repoPath || typeof repoPath !== "string") {
    return { events: [], historyAvailable: false };
  }
  const resolved = path.resolve(repoPath);
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    return { events: [], historyAvailable: false };
  }
  const gitDir = path.join(resolved, ".git");
  if (!existsSync(gitDir)) {
    return { events: [], historyAvailable: false };
  }

  const { stdout, ok } = await runGitLog(resolved);
  if (!ok || !stdout.trim()) {
    return { events: [], historyAvailable: false };
  }

  let events = parseGitBlocks(stdout.trim());
  events = [...events].reverse();

  /* Need at least 3 git commits overall for “deep” history — cheap count */
  const { stdout: countLines } = await new Promise<{ stdout: string; ok: boolean }>((resolve) => {
    const c = spawn("git", ["rev-list", "--count", "HEAD"], { cwd: resolved, env: process.env });
    let o = "";
    c.stdout.setEncoding("utf8");
    c.stdout.on("data", (d) => {
      o += d;
    });
    c.on("error", () => resolve({ stdout: "0", ok: false }));
    c.on("close", (code) => resolve({ stdout: o, ok: code === 0 }));
  });
  const commitCount = parseInt(String(countLines).trim(), 10) || 0;

  const hasMilestones = events.length >= 2;
  const historyAvailable = commitCount >= 3 && hasMilestones;

  return {
    events: historyAvailable ? events : events.length ? events : [],
    //- If shallow git or <3 commits: still return events for caller, but flag unavailable
    historyAvailable,
  };
}
