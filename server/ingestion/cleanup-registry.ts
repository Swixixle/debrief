import fs from "node:fs/promises";

const cleanups = new Set<() => Promise<void>>();
let exitHooked = false;

function ensureExitHook() {
  if (exitHooked) return;
  exitHooked = true;
  const run = async () => {
    await Promise.all([...cleanups].map((fn) => fn().catch(() => {})));
    cleanups.clear();
  };
  process.once("beforeExit", () => void run());
  process.once("SIGINT", () => void run().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void run().finally(() => process.exit(0)));
}

/**
 * Register a temp directory for removal on process exit. Returns a disposer
 * to run sooner (e.g. after analysis) so disk is freed without waiting for exit.
 */
export function registerTempDir(absDir: string): () => Promise<void> {
  ensureExitHook();
  const dispose = async () => {
    cleanups.delete(dispose);
    await fs.rm(absDir, { recursive: true, force: true });
  };
  cleanups.add(dispose);
  return dispose;
}
