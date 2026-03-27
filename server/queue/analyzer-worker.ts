/**
 * BullMQ worker — run with `DEBRIEF_RUN_ANALYZER_WORKER=1` and `DEBRIEF_USE_BULLMQ=1`.
 */
import { Worker, type Job } from "bullmq";
import { ingest } from "../ingestion/ingest";
import {
  applyAnalyzerCacheHit,
  runProjectAnalysis,
  type AnalyzerIngestMeta,
} from "../runProjectAnalysis";
import { computeContentHash, getCachedRun } from "../cache/run-cache";
import { createRedisConnection } from "./analyzer-queue";
import { progressMessage } from "./job-progress";
import { broadcastJobProgress } from "../ws";
import { refundCredits } from "../billing/credits";
import type { IngestInput, IngestResult } from "../ingestion/types";

export type AnalyzerJobData = {
  projectId: number;
  ingestInput: IngestInput;
  reportAudience: "learner" | "pro";
  model?: string;
  userId?: string | null;
  creditCost?: number;
};

function sidecarFromIngestResult(p: IngestResult): AnalyzerIngestMeta {
  return {
    inputType: p.inputType,
    cleanup: p.cleanup,
    inputTypeDetail: p.inputTypeDetail,
    analysisMode: p.analysisMode,
    commitHash: p.commitHash,
    branch: p.branch,
    sourceUrl: p.sourceUrl,
    warnings: p.warnings,
  };
}

export function createAnalyzerWorker(): Worker | null {
  const connection = createRedisConnection();
  if (!connection) return null;

  const worker = new Worker<AnalyzerJobData>(
    "debrief-analyzer",
    async (job: Job<AnalyzerJobData>) => {
      const { projectId, ingestInput, reportAudience, model } = job.data;

      await job.updateProgress(5);
      await broadcastJobProgress(String(job.id), {
        progress: 5,
        message: progressMessage(5),
      });

      const ingestResult = await ingest(ingestInput);

      await job.updateProgress(10);
      await broadcastJobProgress(String(job.id), {
        progress: 10,
        message: progressMessage(10),
      });

      const contentHash = await computeContentHash(ingestResult.localPath);
      const cached = await getCachedRun(contentHash);

      if (cached) {
        await applyAnalyzerCacheHit({
          projectId,
          reportAudience,
          ingestMeta: sidecarFromIngestResult(ingestResult),
          cached,
          contentHashKey: contentHash,
          modelUsed: model ?? null,
        });
        await job.updateProgress(100);
        return { cached: true, runDir: cached.runDir };
      }

      await job.updateProgress(15);
      await broadcastJobProgress(String(job.id), {
        progress: 15,
        message: progressMessage(15),
      });

      const { runDir } = await runProjectAnalysis({
        projectId,
        source: ingestResult.localPath,
        mode: "local",
        ingestMeta: sidecarFromIngestResult(ingestResult),
        reportAudience,
        skipCacheCheck: true,
        contentHashPrecomputed: contentHash,
        modelUsed: model,
        onProgress: async (pct, message) => {
          const p = 15 + Math.floor(Math.min(100, pct) * 0.75);
          await job.updateProgress(p);
          await broadcastJobProgress(String(job.id), { progress: p, message });
        },
      });

      await job.updateProgress(100);
      return { cached: false, runDir };
    },
    {
      connection,
      concurrency: 2,
    },
  );

  worker.on("completed", (job, result) => {
    broadcastJobProgress(String(job.id), {
      progress: 100,
      message:
        result && typeof result === "object" && (result as { cached?: boolean }).cached
          ? "Returned from cache"
          : "Analysis complete",
      result,
    });
  });

  worker.on("failed", async (job, err) => {
    const id = job?.id != null ? String(job.id) : "";
    if (id) {
      broadcastJobProgress(id, {
        progress: -1,
        message: "Analysis failed",
        error: err.message,
      });
    }
    if (job?.data?.userId) {
      await refundCredits(job.data.userId, job.data.creditCost ?? 0);
    }
  });

  return worker;
}
