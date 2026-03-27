import path from "node:path";
import { mkdirSync, appendFileSync } from "node:fs";

const LOG_DIR = path.resolve(process.cwd(), "out", "_log");
const LOG_FILE = path.join(LOG_DIR, "analyzer.ndjson");

export function logAnalyzerEvent(projectId: number, event: string, detail?: Record<string, unknown>) {
  mkdirSync(LOG_DIR, { recursive: true });
  const entry = {
    ts: new Date().toISOString(),
    projectId,
    event,
    ...detail,
  };
  appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
}
