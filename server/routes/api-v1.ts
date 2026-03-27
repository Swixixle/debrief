import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { analyzerQueue } from "../queue/analyzer-queue";
import type { AnalyzerJobData } from "../queue/analyzer-worker";
import { progressMessage } from "../queue/job-progress";
import { detectIngestInputFromRepoUrl } from "../ingestion/detectRepoInput";
import { checkCredits } from "../billing/credits";
import { CREDIT_COSTS } from "../billing/stripe";
import { getAuth } from "../middleware/clerk";

const analyzeBodySchema = z.object({
  repoUrl: z.string().min(1),
  mode: z.enum(["learner", "pro"]).optional().default("learner"),
  model: z.string().optional(),
});

function requireApiKeyOrClerk(req: Request, res: Response, next: NextFunction): void {
  if (req.apiUser) {
    next();
    return;
  }
  try {
    const auth = getAuth(req);
    if (auth.userId) {
      next();
      return;
    }
  } catch {
    /* fallthrough */
  }
  res.status(401).json({ error: "Use Authorization: Bearer dk_... or sign in" });
}

function nameFromRepoUrl(u: string): string {
  try {
    const url = new URL(u);
    const parts = url.pathname.split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1]! : u.slice(0, 80);
  } catch {
    return u.slice(0, 80);
  }
}

export const apiV1Router = Router();

apiV1Router.use(requireApiKeyOrClerk);

apiV1Router.post("/analyze", async (req: Request, res: Response) => {
  const parsed = analyzeBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid body" });
  }
  const { repoUrl, mode, model } = parsed.data;

  const auth = (() => {
    try {
      return getAuth(req);
    } catch {
      return { userId: null as string | null };
    }
  })();
  const clerkUserId = auth.userId ?? req.apiUser?.clerkUserId ?? null;

  const cost = CREDIT_COSTS[mode === "pro" ? "pro" : "learner"];
  const credit = await checkCredits(clerkUserId, cost);
  if (!credit.ok) {
    return res.status(402).json({
      error: "Insufficient credits",
      checkoutUrl: credit.checkoutUrl,
    });
  }

  const q = analyzerQueue();
  if (!q) {
    return res.status(503).json({ error: "Analyzer queue is not enabled (set REDIS_URL and DEBRIEF_USE_BULLMQ=1)" });
  }

  const ingestInput = detectIngestInputFromRepoUrl(repoUrl);
  const project = await storage.createProject(
    {
      url: repoUrl,
      name: nameFromRepoUrl(repoUrl),
      reportAudience: mode,
    },
    "github",
  );

  const payload: AnalyzerJobData = {
    projectId: project.id,
    ingestInput,
    reportAudience: mode,
    model,
    userId: clerkUserId,
    creditCost: cost,
  };

  const job = await q.add("analyze", payload, { jobId: `v1-${project.id}-${Date.now()}` });

  const host = req.get("host") || "localhost:5000";
  const proto = req.protocol || "http";
  const base = `${proto}://${host}`;

  res.status(202).json({
    projectId: project.id,
    jobId: String(job.id),
    statusUrl: `${base}/api/v1/jobs/${job.id}`,
    reportUrl: `${base.replace(/\/$/, "")}/projects/${project.id}`,
  });
});

apiV1Router.get("/jobs/:jobId", async (req: Request, res: Response) => {
  const q = analyzerQueue();
  if (!q) {
    return res.status(503).json({ error: "Queue not enabled" });
  }
  const job = await q.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }
  const state = await job.getState();
  const progressRaw = job.progress;
  const progress =
    typeof progressRaw === "number"
      ? progressRaw
      : typeof progressRaw === "object" &&
          progressRaw &&
          "value" in progressRaw &&
          typeof (progressRaw as { value?: unknown }).value === "number"
        ? (progressRaw as { value: number }).value
        : 0;
  res.json({
    jobId: job.id,
    status: state,
    progress,
    message: progressMessage(Number(progress) || 0),
    result: job.returnvalue ?? null,
    error: job.failedReason ?? null,
  });
});

apiV1Router.get("/projects/:id", async (req: Request, res: Response) => {
  const project = await storage.getProject(Number(req.params.id));
  if (!project) {
    return res.status(404).json({ error: "Not found" });
  }
  res.json(project);
});

apiV1Router.get("/projects/:id/report", async (req: Request, res: Response) => {
  const analysis = await storage.getAnalysisByProjectId(Number(req.params.id));
  if (!analysis) {
    return res.status(404).json({ error: "No analysis yet" });
  }
  const report = analysis.learnerReport ?? analysis.dossier ?? "";
  res.type("text/markdown; charset=utf-8").send(report);
});
