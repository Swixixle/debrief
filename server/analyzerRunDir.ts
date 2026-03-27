/**
 * Analyzer CLI writes all run artifacts under `<outputDir>/runs/<run-id>/`.
 * Helpers to resolve the latest run directory for consumers (Express, CI worker).
 */
import path from "path";
import { existsSync } from "fs";
import { readdir } from "fs/promises";

/** Lexicographic descending: run ids are UTC-prefixed (e.g. 20260327T064522Z-abc1234). */
export async function getLatestAnalyzerRunDir(outputDir: string): Promise<string | null> {
  const runsDir = path.join(outputDir, "runs");
  if (!existsSync(runsDir)) return null;
  let entries;
  try {
    entries = await readdir(runsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  if (dirs.length === 0) return null;
  dirs.sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
  return path.join(runsDir, dirs[0]);
}
