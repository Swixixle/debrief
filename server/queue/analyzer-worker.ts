/**
 * BullMQ worker entry — start alongside API when REDIS_URL and DEBRIEF_USE_BULLMQ=1.
 *
 * Intended flow (mirror of `runAnalysis` in routes):
 * 1. `ingest(ingestInput)` → localPath + metadata
 * 2. Run Python analyzer → artifacts under out/<projectId>/
 * 3. Persist analyses + runs rows; optional Redis content-hash cache
 *
 * Wire this process in a separate script or guard `server/index.ts` with env
 * `DEBRIEF_RUN_ANALYZER_WORKER=1` when ready to avoid duplicating work with Express.
 */
import { Worker } from "bullmq";
import Redis from "ioredis";

const redisOpts = { maxRetriesPerRequest: null, enableReadyCheck: false } as const;

export function createAnalyzerWorker(): Worker | null {
  const url = process.env.REDIS_URL;
  if (!url || process.env.DEBRIEF_USE_BULLMQ !== "1") return null;
  const connection = new Redis(url, { ...redisOpts });
  return new Worker(
    "debrief-analyzer",
    async (_job) => {
      throw new Error("Analyzer worker not yet wired — use inline runAnalysis in API process");
    },
    { connection },
  );
}
