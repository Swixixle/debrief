import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Best-effort: shallow clone may report HEAD as branch name. */
export async function readGitMeta(repoDir: string): Promise<{ commitHash: string; branch: string }> {
  const opts = { cwd: repoDir, maxBuffer: 1024 * 1024 } as const;
  const [headOut, branchOut] = await Promise.all([
    execFileAsync("git", ["rev-parse", "HEAD"], opts).then((r) => String(r.stdout).trim()),
    execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], opts)
      .then((r) => String(r.stdout).trim())
      .catch(() => ""),
  ]);
  return {
    commitHash: headOut || "unknown",
    branch: branchOut || "unknown",
  };
}
