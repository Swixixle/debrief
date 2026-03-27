/**
 * Standalone BullMQ worker process for Render / other hosts.
 * API service should set DEBRIEF_RUN_ANALYZER_WORKER=0; this process runs only the worker.
 */
import { createAnalyzerWorker } from "./queue/analyzer-worker";

if (process.env.DEBRIEF_USE_BULLMQ !== "1") {
  process.env.DEBRIEF_USE_BULLMQ = "1";
}

const worker = createAnalyzerWorker();
if (!worker) {
  console.error(
    "[analyzer-worker] Failed to start — set REDIS_URL and ensure DEBRIEF_USE_BULLMQ=1 (set automatically here).",
  );
  process.exit(1);
}

console.log("[analyzer-worker] Started debrief-analyzer worker");

async function shutdown(signal: string) {
  console.log(`[analyzer-worker] ${signal}, closing…`);
  await worker.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
