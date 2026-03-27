import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { matchCloneAnalyzeUrl } from "@shared/cloneAnalyzeUrl";
import os from "node:os";
import { z } from "zod";
import multer from "multer";
import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import { existsSync, readFileSync, appendFileSync, mkdirSync, createReadStream } from "fs";
import crypto from "crypto";
import { processOneJob, startWorkerLoop, getDiskStatus } from "./ci-worker";
import { getLatestAnalyzerRunDir } from "./analyzerRunDir";
import { 
  generateEvidenceBundle, 
  generateTenantKeyPair, 
  verifyEvidenceBundle,
  type EvidenceBundleOptions 
} from "./evidence-bundle";
import {
  ingest,
  hostedHttpsGitToIngestInput,
  assertLocalPathAllowedForIngest,
} from "./ingestion/ingest";
import type { IngestInput, IngestResult } from "./ingestion/types";
import {
  computeContentHash,
  getCachedRun,
  setCachedRun,
  buildCachedRunFromArtifacts,
} from "./cache/run-cache";
import { extractRunSummary } from "./runMetrics";
import type { Project } from "@shared/schema";

const LOG_DIR = path.resolve(process.cwd(), "out", "_log");
const LOG_FILE = path.join(LOG_DIR, "analyzer.ndjson");

function logEvent(projectId: number, event: string, detail?: Record<string, unknown>) {
  mkdirSync(LOG_DIR, { recursive: true });
  const entry = {
    ts: new Date().toISOString(),
    projectId,
    event,
    ...detail,
  };
  appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
}

function logAdminEvent(event: string, detail?: Record<string, unknown>) {
  logEvent(0, event, detail);
}

// Rate limiters for different endpoints
const adminAuthRateLimiter = createRateLimiter(5, 60_000); // 5 attempts per minute
const projectApiRateLimiter = createRateLimiter(100, 60_000); // 100 requests per minute
const ciApiRateLimiter = createRateLimiter(50, 60_000); // 50 requests per minute
const healthRateLimiter = createRateLimiter(30, 60_000); // 30 requests per minute
const dossierRateLimiter = createRateLimiter(20, 60_000); // 20 requests per minute

type IngestSidecar = {
  inputType?: string;
  cleanup?: () => Promise<void>;
  inputTypeDetail?: string;
  analysisMode?: string;
  commitHash?: string;
  branch?: string;
  sourceUrl?: string;
  warnings?: string[];
};
const ingestSidecarByProject = new Map<number, IngestSidecar>();

function sidecarFromIngestResult(p: IngestResult): IngestSidecar {
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

async function ingestInputForStoredProject(project: Project): Promise<IngestInput> {
  const mode = project.mode || "github";
  if (mode === "github") {
    return { type: "github", url: project.url };
  }
  if (mode === "local") {
    await assertLocalPathAllowedForIngest(project.url);
    return { type: "local", path: project.url };
  }
  if (mode === "git_clone") {
    const m = matchCloneAnalyzeUrl(project.url);
    if (m) return { type: "replit", url: project.url };
    return hostedHttpsGitToIngestInput(project.url);
  }
  throw new Error(`Cannot derive ingest input for project mode: ${mode}`);
}

const LEARNER_AUDIO_BANNER =
  "> **Note:** This analysis is based on your voice description, not source code. All claims are INFERRED until you connect a repository.\n\n";

const ingestPayloadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("github"), url: z.string().min(1) }),
  z.object({ type: z.literal("local"), path: z.string().min(1) }),
  z.object({ type: z.literal("replit"), url: z.string().min(1) }),
  z.object({ type: z.literal("zip"), filePath: z.string().min(1) }),
  z.object({ type: z.literal("url"), url: z.string().min(1) }),
  z.object({ type: z.literal("audio"), filePath: z.string().min(1) }),
  z.object({ type: z.literal("text"), content: z.string().min(1) }),
  z.object({ type: z.literal("notion"), url: z.string().min(1) }),
  z.object({ type: z.literal("gitlab"), url: z.string().min(1) }),
  z.object({ type: z.literal("bitbucket"), url: z.string().min(1) }),
]);

const ingestAnalyzeBodySchema = z.object({
  ingest: ingestPayloadSchema,
  name: z.string().optional(),
  reportAudience: z.enum(["pro", "learner"]).optional(),
});

function requireDevAdmin(req: any, res: any): boolean {
  // Rate limit authentication attempts
  if (!adminAuthRateLimiter()) {
    logAdminEvent("admin_rate_limited", {
      path: req.path,
      ip: req.ip,
      ua: String(req.headers["user-agent"] || ""),
    });
    res.status(429).json({ error: "Too many authentication attempts" });
    return false;
  }

  const required = process.env.ADMIN_KEY;
  if (!required || required.length === 0) {
    // In production, admin key is required
    if (process.env.NODE_ENV === "production") {
      logAdminEvent("admin_key_not_configured", {
        path: req.path,
        ip: req.ip,
      });
      res.status(500).json({ error: "Admin authentication not configured" });
      return false;
    }
    // In development without key, log warning
    logAdminEvent("admin_unguarded", {
      path: req.path,
      ip: req.ip,
      ua: String(req.headers["user-agent"] || ""),
    });
    return true;
  }

  const provided = String(req.headers["x-admin-key"] || "");
  
  // Use timing-safe comparison to prevent timing attacks
  // Pad both to same length to prevent length-based timing attacks
  const maxLen = Math.max(provided.length, required.length);
  const providedPadded = provided.padEnd(maxLen, '\0');
  const requiredPadded = required.padEnd(maxLen, '\0');
  const providedBuf = Buffer.from(providedPadded);
  const requiredBuf = Buffer.from(requiredPadded);
  
  const isValid = crypto.timingSafeEqual(providedBuf, requiredBuf) && provided.length === required.length;
  
  if (!isValid) {
    logAdminEvent("admin_auth_failed", {
      path: req.path,
      ip: req.ip,
      ua: String(req.headers["user-agent"] || ""),
      provided_length: provided.length,
    });
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }

  logAdminEvent("admin_auth_success", {
    path: req.path,
    ip: req.ip,
  });
  return true;
}

// Middleware to require authentication for API endpoints
function requireAuth(req: any, res: any): boolean {
  const apiKey = process.env.API_KEY;
  
  // If API_KEY is not set in production, require it
  if (process.env.NODE_ENV === "production" && (!apiKey || apiKey.length === 0)) {
    res.status(500).json({ error: "API authentication not configured" });
    return false;
  }

  // In development without API_KEY, allow access
  if (!apiKey || apiKey.length === 0) {
    return true;
  }

  const provided = String(req.headers["x-api-key"] || "");
  
  // Use timing-safe comparison to prevent timing attacks
  // Pad both to same length to prevent length-based timing attacks
  const maxLen = Math.max(provided.length, apiKey.length);
  const providedPadded = provided.padEnd(maxLen, '\0');
  const apiKeyPadded = apiKey.padEnd(maxLen, '\0');
  const providedBuf = Buffer.from(providedPadded);
  const apiKeyBuf = Buffer.from(apiKeyPadded);
  
  const isValid = crypto.timingSafeEqual(providedBuf, apiKeyBuf) && provided.length === apiKey.length;
  
  if (!isValid) {
    logEvent(0, "api_auth_failed", {
      path: req.path,
      ip: req.ip,
      ua: String(req.headers["user-agent"] || ""),
    });
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }

  return true;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.get("/health", async (_req, res) => {
    if (!healthRateLimiter()) {
      return res.status(429).json({ error: "Rate limit exceeded" });
    }
    const dbOk = await storage.getProjects().then(() => true).catch(() => false);
    res.json({ ok: true, db: dbOk, uptime: process.uptime() });
  });

  // Enhanced health endpoint with comprehensive checks
  app.get("/api/health", async (req: Request, res: Response) => {
    if (!healthRateLimiter()) {
      return res.status(429).json({ error: "Rate limit exceeded" });
    }
    
    // Basic health check is public, but detailed checks require auth in production
    let isAuthenticated = false;
    if (process.env.NODE_ENV === "production" && process.env.API_KEY) {
      const provided = String(req.headers["x-api-key"] || "");
      const apiKey = process.env.API_KEY;
      // Use timing-safe comparison
      const maxLen = Math.max(provided.length, apiKey.length);
      const providedPadded = provided.padEnd(maxLen, '\0');
      const apiKeyPadded = apiKey.padEnd(maxLen, '\0');
      const providedBuf = Buffer.from(providedPadded);
      const apiKeyBuf = Buffer.from(apiKeyPadded);
      isAuthenticated = crypto.timingSafeEqual(providedBuf, apiKeyBuf) && provided.length === apiKey.length;
    } else {
      // In dev or when API_KEY is not set, allow access
      isAuthenticated = true;
    }
    
    const checks: Record<string, any> = {
      timestamp: new Date().toISOString(),
      uptime_seconds: process.uptime(),
      node_env: process.env.NODE_ENV || "development",
    };

    // Version info
    try {
      const pkg = require("../package.json");
      checks.version = pkg.version || "unknown";
    } catch {
      checks.version = "unknown";
    }

    // Database check
    try {
      await storage.getProjects();
      checks.database = { status: "ok", message: "Database connection successful" };
    } catch (err: any) {
      const message = isAuthenticated && process.env.NODE_ENV !== "production" 
        ? (err.message || "Database connection failed")
        : "Database connection failed";
      checks.database = { status: "error", message };
    }

    // Only expose detailed internals to authenticated users
    if (isAuthenticated) {
      // Analyzer check (verify Python analyzer is accessible)
      try {
        const analyzerPath = path.join(process.cwd(), "server", "analyzer", "analyzer_cli.py");
        const analyzerExists = existsSync(analyzerPath);
        checks.analyzer = {
          status: analyzerExists ? "ok" : "error",
          path: analyzerPath,
          exists: analyzerExists,
        };
      } catch (err: any) {
        const message = process.env.NODE_ENV !== "production"
          ? (err.message || "Analyzer check failed")
          : "Analyzer check failed";
        checks.analyzer = { status: "error", message };
      }

      // Worker check (CI job processing)
      try {
        const jobCounts = await storage.getCiJobCounts();
        const lastRun = await storage.getLastCompletedRun();
        checks.worker = {
          status: "ok",
          jobs: jobCounts,
          last_completed: lastRun
            ? {
                id: lastRun.id,
                finished_at: lastRun.finishedAt,
                repo: `${lastRun.repoOwner}/${lastRun.repoName}`,
              }
            : null,
        };
      } catch (err: any) {
        const message = process.env.NODE_ENV !== "production"
          ? (err.message || "Worker check failed")
          : "Worker check failed";
        checks.worker = { status: "error", message };
      }

      // Disk check
      try {
        const disk = getDiskStatus();
        checks.disk = {
          status: disk.ciTmpDirLowDisk ? "warning" : "ok",
          ci_tmp_dir: disk.ciTmpDir,
          free_bytes: disk.ciTmpDirFreeBytes,
          low_disk: disk.ciTmpDirLowDisk,
        };
      } catch (err: any) {
        const message = process.env.NODE_ENV !== "production"
          ? (err.message || "Disk check failed")
          : "Disk check failed";
        checks.disk = { status: "error", message };
      }
    }

    // Overall status
    const hasErrors = Object.values(checks).some(
      (check) => typeof check === "object" && check.status === "error"
    );
    const hasWarnings = Object.values(checks).some(
      (check) => typeof check === "object" && check.status === "warning"
    );

    const overallStatus = hasErrors ? "unhealthy" : hasWarnings ? "degraded" : "healthy";

    res.status(hasErrors ? 503 : 200).json({
      status: overallStatus,
      checks,
    });
  });

  app.get(api.projects.list.path, async (req, res) => {
    if (!projectApiRateLimiter()) {
      return res.status(429).json({ error: "Rate limit exceeded" });
    }
    if (!requireAuth(req, res)) return;
    const projects = await storage.getProjects();
    res.json(projects);
  });

  app.post(api.projects.create.path, async (req, res) => {
    if (!projectApiRateLimiter()) {
      return res.status(429).json({ error: "Rate limit exceeded" });
    }
    if (!requireAuth(req, res)) return;
    try {
      const input = api.projects.create.input.parse(req.body);
      const { mode, reportAudience, ...projectData } = input;
      const project = await storage.createProject(
        { ...projectData, reportAudience: reportAudience ?? "pro" },
        mode || "github",
      );
      res.status(201).json(project);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
        return;
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get(api.projects.get.path, async (req, res) => {
    if (!projectApiRateLimiter()) {
      return res.status(429).json({ error: "Rate limit exceeded" });
    }
    if (!requireAuth(req, res)) return;
    const project = await storage.getProject(Number(req.params.id));
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }
    res.json(project);
  });

  app.get(api.projects.getAnalysis.path, async (req, res) => {
    if (!projectApiRateLimiter()) {
      return res.status(429).json({ error: "Rate limit exceeded" });
    }
    if (!requireAuth(req, res)) return;
    const analysis = await storage.getAnalysisByProjectId(Number(req.params.id));
    if (!analysis) {
      return res.status(404).json({ message: 'Analysis not found' });
    }
    res.json(analysis);
  });

  app.post(api.projects.analyze.path, async (req, res) => {
    if (!projectApiRateLimiter()) {
      return res.status(429).json({ error: "Rate limit exceeded" });
    }
    if (!requireAuth(req, res)) return;
    const projectId = Number(req.params.id);
    const project = await storage.getProject(projectId);

    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    const pmode = project.mode || "github";
    if (pmode === "replit") {
      if (!isValidRepositoryUrl(project.url, "replit")) {
        logEvent(projectId, "invalid_url", { url: project.url, mode: project.mode });
        return res.status(400).json({ message: "Invalid repository URL" });
      }
      runAnalysis(project.id, project.url, "replit");
      return res.status(202).json({ message: "Analysis started" });
    }

    const urlMode =
      pmode === "git_clone" ? "git_clone" : pmode === "local" ? "local" : "github";
    if (!isValidRepositoryUrl(project.url, urlMode)) {
      logEvent(projectId, "invalid_url", { url: project.url, mode: project.mode });
      return res.status(400).json({ message: "Invalid repository URL" });
    }

    let prepared: IngestResult;
    try {
      prepared = await ingest(await ingestInputForStoredProject(project));
    } catch (err: any) {
      logEvent(projectId, "ingest_failed", { error: String(err?.message || err) });
      return res.status(400).json({ message: err?.message || "ingest failed" });
    }

    runAnalysis(project.id, prepared.localPath, "local", sidecarFromIngestResult(prepared));
    res.status(202).json({ message: "Analysis started" });
  });

  app.post(api.projects.analyzeReplit.path, async (req, res) => {
    if (!projectApiRateLimiter()) {
      return res.status(429).json({ error: "Rate limit exceeded" });
    }
    if (!requireAuth(req, res)) return;
    try {
      const workspaceRoot = process.cwd();
      const folderName = path.basename(workspaceRoot);

      const project = await storage.createProject(
        { url: workspaceRoot, name: `Replit: ${folderName}` },
        "replit"
      );

      runAnalysis(project.id, workspaceRoot, "replit");

      res.status(201).json(project);
    } catch (err) {
      console.error("Error starting Replit analysis:", err);
      res.status(500).json({ message: "Failed to start Replit analysis" });
    }
  });

  app.post(api.projects.cloneAnalyze.path, async (req, res) => {
    if (!projectApiRateLimiter()) {
      return res.status(429).json({ error: "Rate limit exceeded" });
    }
    if (!requireAuth(req, res)) return;
    try {
      const input = api.projects.cloneAnalyze.input.parse(req.body);
      const match = matchCloneAnalyzeUrl(input.gitUrl);
      if (!match) {
        return res.status(400).json({
          message: "Unsupported URL for clone analysis. Use a Replit repl URL like https://replit.com/@user/repl",
        });
      }
      if (!isValidRepositoryUrl(match.cloneUrl, "git_clone")) {
        return res.status(400).json({ message: "Invalid clone URL" });
      }
      const name = (input.name && input.name.trim()) || `Replit: ${match.label}`;
      const project = await storage.createProject({ url: match.cloneUrl, name }, "git_clone");
      let prepared: IngestResult;
      try {
        prepared = await ingest({ type: "replit", url: match.cloneUrl });
      } catch (err: any) {
        return res.status(400).json({ message: err?.message || "ingest failed" });
      }
      runAnalysis(project.id, prepared.localPath, "local", sidecarFromIngestResult(prepared));
      res.status(201).json(project);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          message: err.errors[0]?.message || "Invalid request",
          field: err.errors[0]?.path.join("."),
        });
        return;
      }
      console.error("Error starting clone analysis:", err);
      res.status(500).json({ message: "Failed to start clone analysis" });
    }
  });

  app.get("/api/dossiers/lantern", (req, res) => {
    if (!dossierRateLimiter()) {
      return res.status(429).json({ error: "Rate limit exceeded" });
    }
    // Public documentation endpoint - no auth required but rate limited
    const p = path.join(process.cwd(), "docs/dossiers/lantern_program_totality_dossier.md");
    if (!existsSync(p)) return res.status(404).json({ error: "Not found" });
    res.type("text/markdown").send(readFileSync(p, "utf8"));
  });

  app.get("/api/admin/analyzer-log", async (req, res) => {
    if (!requireDevAdmin(req, res)) return;
    try {
      if (!existsSync(LOG_FILE)) return res.json([]);
      const raw = await fs.readFile(LOG_FILE, "utf-8");
      const lines = raw.split("\n").filter(Boolean);
      const parsed = lines.map((l) => {
        try { return JSON.parse(l); } catch { return { parse_error: true, line: l }; }
      });
      res.json(parsed);
    } catch (err) {
      res.status(500).json({ error: "failed_to_read_log" });
    }
  });

  app.post("/api/admin/analyzer-log/clear", async (req, res) => {
    if (!requireDevAdmin(req, res)) return;
    try {
      await fs.mkdir(LOG_DIR, { recursive: true });
      await fs.rm(LOG_FILE, { force: true });
      await fs.writeFile(LOG_FILE, "", "utf8");
      logAdminEvent("log_cleared", {
        ip: req.ip,
        ua: String(req.headers["user-agent"] || ""),
      });
      return res.json({ ok: true });
    } catch (err) {
      console.error("Failed to clear analyzer log:", err);
      return res.status(500).json({ ok: false });
    }
  });

  app.post("/api/admin/reset-analyzer", async (req, res) => {
    if (!requireDevAdmin(req, res)) return;
    try {
      await storage.resetAnalyzerLogbook();
      await fs.rm(path.resolve(process.cwd(), "out"), { recursive: true, force: true });
      await fs.mkdir(path.resolve(process.cwd(), "out"), { recursive: true });
      logAdminEvent("reset_analyzer", {
        ip: req.ip,
        ua: String(req.headers["user-agent"] || ""),
      });
      console.log("[Admin] Analyzer logbook + DB + out/ reset");
      res.json({ ok: true });
    } catch (err) {
      console.error("[Admin] Reset failed:", err);
      res.status(500).json({ message: "Reset failed" });
    }
  });

  // ============== EVIDENCE BUNDLE ROUTES (PHASE 1) ==============

  const evidenceBundleRateLimiter = createRateLimiter(20, 60_000); // 20 requests per minute

  // In-memory key store (in production, this would be a secure key management service)
  // Each tenant gets their own key pair
  const tenantKeys = new Map<string, { privateKey: string; publicKey: string }>();

  function getTenantKeys(tenantId: string): { privateKey: string; publicKey: string } {
    if (!tenantKeys.has(tenantId)) {
      tenantKeys.set(tenantId, generateTenantKeyPair());
    }
    return tenantKeys.get(tenantId)!;
  }

  // POST /api/certificates - Create a new evidence bundle certificate
  app.post("/api/certificates", async (req: Request, res: Response) => {
    if (!evidenceBundleRateLimiter()) {
      return res.status(429).json({ error: "Rate limit exceeded" });
    }
    if (!requireAuth(req, res)) return;

    try {
      const schema = z.object({
        analysisId: z.number(),
        tenantId: z.string().min(1),
        modelVersion: z.string().optional(),
        promptVersion: z.string().optional(),
        governancePolicyVersion: z.string().optional(),
        humanReviewed: z.boolean().optional(),
        reviewerHash: z.string().optional(),
        ehrReferencedAt: z.string().optional(),
      });

      const input = schema.parse(req.body);

      // Fetch the analysis
      const analysis = await storage.getAnalysisByProjectId(input.analysisId);
      if (!analysis) {
        return res.status(404).json({ error: "Analysis not found" });
      }

      // Get or generate tenant keys
      const { privateKey, publicKey } = getTenantKeys(input.tenantId);

      // Generate certificate ID
      const certificateId = crypto.randomUUID();

      // Generate evidence bundle
      const bundleOptions: EvidenceBundleOptions = {
        analysisId: input.analysisId,
        tenantId: input.tenantId,
        analysis,
        modelVersion: input.modelVersion,
        promptVersion: input.promptVersion,
        governancePolicyVersion: input.governancePolicyVersion,
        humanReviewed: input.humanReviewed,
        reviewerHash: input.reviewerHash,
        ehrReferencedAt: input.ehrReferencedAt,
      };

      const evidenceBundle = generateEvidenceBundle(
        certificateId,
        bundleOptions,
        privateKey,
        publicKey
      );

      // Store certificate in database
      const certificate = await storage.createCertificate({
        analysisId: input.analysisId,
        tenantId: input.tenantId,
        certificateData: evidenceBundle as any,
        signature: evidenceBundle.signature.signature,
        publicKey: publicKey,
        noteHash: evidenceBundle.hashes.note_hash,
        hashAlgorithm: evidenceBundle.hashes.hash_algorithm,
      });

      console.log(`[Evidence Bundle] Created certificate ${certificate.id} for analysis ${input.analysisId}`);
      res.status(201).json({ ok: true, certificate_id: certificate.id });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          error: "validation_error",
          details: err.errors,
        });
        return;
      }
      console.error("[Evidence Bundle] Creation failed:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/certificates/:id/evidence-bundle.json - Get evidence bundle as JSON
  app.get("/api/certificates/:id/evidence-bundle.json", async (req: Request, res: Response) => {
    if (!evidenceBundleRateLimiter()) {
      return res.status(429).json({ error: "Rate limit exceeded" });
    }
    if (!requireAuth(req, res)) return;

    try {
      const certificateId = req.params.id;
      const certificate = await storage.getCertificate(certificateId);

      if (!certificate) {
        return res.status(404).json({ error: "Certificate not found" });
      }

      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="evidence-bundle-${certificateId}.json"`);
      res.json(certificate.certificateData);
    } catch (err) {
      console.error("[Evidence Bundle] Retrieval failed:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/certificates/:id - Get certificate metadata
  app.get("/api/certificates/:id", async (req: Request, res: Response) => {
    if (!evidenceBundleRateLimiter()) {
      return res.status(429).json({ error: "Rate limit exceeded" });
    }
    if (!requireAuth(req, res)) return;

    try {
      const certificateId = req.params.id;
      const certificate = await storage.getCertificate(certificateId);

      if (!certificate) {
        return res.status(404).json({ error: "Certificate not found" });
      }

      res.json({
        ok: true,
        certificate: {
          id: certificate.id,
          analysis_id: certificate.analysisId,
          tenant_id: certificate.tenantId,
          note_hash: certificate.noteHash,
          hash_algorithm: certificate.hashAlgorithm,
          issued_at: certificate.issuedAt,
          created_at: certificate.createdAt,
        },
      });
    } catch (err) {
      console.error("[Evidence Bundle] Metadata retrieval failed:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/certificates/verify - Verify an evidence bundle
  app.post("/api/certificates/verify", async (req: Request, res: Response) => {
    if (!evidenceBundleRateLimiter()) {
      return res.status(429).json({ error: "Rate limit exceeded" });
    }
    // Verification endpoint is public but rate limited

    try {
      const bundle = req.body;

      if (!bundle || typeof bundle !== "object") {
        return res.status(400).json({ error: "Invalid bundle format" });
      }

      const result = verifyEvidenceBundle(bundle);
      
      res.json({
        ok: true,
        valid: result.valid,
        errors: result.errors,
      });
    } catch (err) {
      console.error("[Evidence Bundle] Verification failed:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/certificates - List certificates by tenant
  app.get("/api/certificates", async (req: Request, res: Response) => {
    if (!evidenceBundleRateLimiter()) {
      return res.status(429).json({ error: "Rate limit exceeded" });
    }
    if (!requireAuth(req, res)) return;

    try {
      const tenantId = String(req.query.tenant_id || "");
      const limit = Math.min(Number(req.query.limit) || 50, 200);

      if (!tenantId) {
        return res.status(400).json({ error: "tenant_id query param required" });
      }

      const certificates = await storage.getCertificatesByTenantId(tenantId, limit);
      
      res.json({
        ok: true,
        certificates: certificates.map(cert => ({
          id: cert.id,
          analysis_id: cert.analysisId,
          tenant_id: cert.tenantId,
          note_hash: cert.noteHash,
          issued_at: cert.issuedAt,
        })),
      });
    } catch (err) {
      console.error("[Evidence Bundle] List failed:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ============== CI FEED ROUTES ==============

  const webhookRateLimiter = createRateLimiter(30, 60_000);

  app.post("/api/webhooks/github", async (req: Request, res: Response) => {
    if (!webhookRateLimiter()) {
      return res.status(429).json({ error: "rate_limited" });
    }

    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) {
      console.error("[Webhook] GITHUB_WEBHOOK_SECRET not set");
      return res.status(500).json({ error: "webhook_not_configured" });
    }

    const sigHeader = req.headers["x-hub-signature-256"] as string | undefined;
    if (!sigHeader) {
      return res.status(401).json({ error: "missing_signature" });
    }

    const rawBody = JSON.stringify(req.body);
    const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    const sigBuf = Buffer.from(sigHeader);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return res.status(401).json({ error: "invalid_signature" });
    }

    const deliveryId = req.headers["x-github-delivery"] as string | undefined;
    const event = req.headers["x-github-event"] as string;

    if (!deliveryId || !event) {
      return res.status(400).json({ ok: false, error: "missing_delivery_id" });
    }

    const payload = req.body;
    const repoOwner = payload.repository?.owner?.login || payload.repository?.owner?.name;
    const repoNameForDelivery = payload.repository?.name;

    const isNew = await storage.checkAndRecordDelivery(deliveryId, event, repoOwner, repoNameForDelivery);
    if (!isNew) {
      console.log(`[Webhook] Replay blocked: delivery=${deliveryId}`);
      return res.status(202).json({ ok: true, deduped: true });
    }

    if (event === "push") {
      const owner = payload.repository?.owner?.login || payload.repository?.owner?.name;
      const repo = payload.repository?.name;
      const refFull = payload.ref || "";
      const ref = refFull.replace("refs/heads/", "");
      const sha = payload.after;

      if (!owner || !repo || !sha) {
        return res.status(400).json({ error: "missing_fields" });
      }

      const existing = await storage.findExistingCiRun(owner, repo, sha);
      if (existing) {
        console.log(`[Webhook] Deduplicated push for ${owner}/${repo}@${sha}`);
        return res.json({ ok: true, run_id: existing.id, deduplicated: true });
      }

      const run = await storage.createCiRun({ repoOwner: owner, repoName: repo, ref, commitSha: sha, eventType: "push", status: "QUEUED" });
      await storage.createCiJob(run.id);
      console.log(`[Webhook] Created run ${run.id} for push ${owner}/${repo}@${sha}`);
      return res.json({ ok: true, run_id: run.id });

    } else if (event === "pull_request") {
      const action = payload.action;
      if (!["opened", "synchronize", "reopened"].includes(action)) {
        return res.status(202).json({ ok: true, ignored: true });
      }

      const owner = payload.repository?.owner?.login;
      const repo = payload.repository?.name;
      const ref = payload.pull_request?.head?.ref;
      const sha = payload.pull_request?.head?.sha;

      if (!owner || !repo || !ref || !sha) {
        return res.status(400).json({ error: "missing_fields" });
      }

      const existing = await storage.findExistingCiRun(owner, repo, sha);
      if (existing) {
        return res.json({ ok: true, run_id: existing.id, deduplicated: true });
      }

      const run = await storage.createCiRun({ repoOwner: owner, repoName: repo, ref, commitSha: sha, eventType: "pull_request", status: "QUEUED" });
      await storage.createCiJob(run.id);
      console.log(`[Webhook] Created run ${run.id} for PR ${owner}/${repo}@${sha}`);
      return res.json({ ok: true, run_id: run.id });

    } else {
      return res.status(202).json({ ok: true, ignored: true });
    }
  });

  app.get("/api/ci/runs", async (req: Request, res: Response) => {
    if (!ciApiRateLimiter()) {
      return res.status(429).json({ error: "Rate limit exceeded" });
    }
    if (!requireAuth(req, res)) return;
    const owner = String(req.query.owner || "");
    const repo = String(req.query.repo || "");
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    if (!owner || !repo) {
      return res.status(400).json({ error: "owner and repo query params required" });
    }

    const runs = await storage.getCiRuns(owner, repo, limit);
    res.json({ ok: true, runs });
  });

  app.get("/api/ci/runs/:id", async (req: Request, res: Response) => {
    if (!ciApiRateLimiter()) {
      return res.status(429).json({ error: "Rate limit exceeded" });
    }
    if (!requireAuth(req, res)) return;
    const run = await storage.getCiRun(String(req.params.id));
    if (!run) {
      return res.status(404).json({ error: "run not found" });
    }
    res.json({ ok: true, run });
  });

  app.post("/api/ci/enqueue", async (req: Request, res: Response) => {
    if (!ciApiRateLimiter()) {
      return res.status(429).json({ error: "Rate limit exceeded" });
    }
    if (!requireAuth(req, res)) return;
    const { owner, repo, ref, commit_sha, event_type } = req.body || {};
    if (!owner || !repo || !ref || !commit_sha) {
      return res.status(400).json({ error: "missing required fields: owner, repo, ref, commit_sha" });
    }

    const existing = await storage.findExistingCiRun(owner, repo, commit_sha);
    if (existing) {
      return res.json({ ok: true, run_id: existing.id, deduplicated: true });
    }

    const run = await storage.createCiRun({
      repoOwner: owner,
      repoName: repo,
      ref,
      commitSha: commit_sha,
      eventType: event_type || "manual",
      status: "QUEUED",
    });
    await storage.createCiJob(run.id);
    console.log(`[CI] Manual enqueue: run=${run.id} ${owner}/${repo}@${commit_sha}`);
    res.json({ ok: true, run_id: run.id });
  });

  app.post("/api/ci/worker/tick", async (req: Request, res: Response) => {
    if (!ciApiRateLimiter()) {
      return res.status(429).json({ error: "Rate limit exceeded" });
    }
    if (!requireAuth(req, res)) return;
    try {
      const result = await processOneJob();
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.get("/api/ci/health", async (req: Request, res: Response) => {
    if (!ciApiRateLimiter()) {
      return res.status(429).json({ error: "Rate limit exceeded" });
    }
    if (!requireAuth(req, res)) return;
    try {
      const jobCounts = await storage.getCiJobCounts();
      const lastRun = await storage.getLastCompletedRun();
      const disk = getDiskStatus();
      res.json({
        ok: true,
        jobs: jobCounts,
        last_completed: lastRun ? {
          id: lastRun.id,
          status: lastRun.status,
          finished_at: lastRun.finishedAt,
          repo: `${lastRun.repoOwner}/${lastRun.repoName}`,
        } : null,
        ciTmpDir: disk.ciTmpDir,
        ciTmpDirFreeBytes: disk.ciTmpDirFreeBytes,
        ciTmpDirLowDisk: disk.ciTmpDirLowDisk,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  const uploadIngest = multer({
    dest: path.join(os.tmpdir(), "debrief-upload"),
    limits: { fileSize: 220 * 1024 * 1024 },
  });

  app.post("/api/ingest/analyze", async (req: Request, res: Response) => {
    if (!projectApiRateLimiter()) {
      return res.status(429).json({ error: "Rate limit exceeded" });
    }
    if (!requireAuth(req, res)) return;
    const parsed = ingestAnalyzeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: parsed.error.issues[0]?.message || "invalid ingest body",
      });
    }
    let prepared;
    try {
      prepared = await ingest(parsed.data.ingest);
    } catch (err: any) {
      return res.status(400).json({ message: err?.message || "ingest failed" });
    }
    const spec = parsed.data.ingest;
    let displayUrl = "Debrief import";
    if ("url" in spec && typeof spec.url === "string") displayUrl = spec.url;
    else if ("path" in spec && typeof spec.path === "string") displayUrl = `file://${spec.path}`;

    const project = await storage.createProject(
      {
        url: displayUrl,
        name: parsed.data.name || "Debrief import",
        reportAudience: parsed.data.reportAudience ?? "pro",
      },
      "local",
    );
    runAnalysis(project.id, prepared.localPath, "local", sidecarFromIngestResult(prepared));
    res.status(202).json({
      ok: true,
      projectId: project.id,
      detected: prepared.inputType,
      inputTypeDetail: prepared.inputTypeDetail,
      analysisMode: prepared.analysisMode,
      warnings: prepared.warnings,
    });
  });

  app.post(
    "/api/ingest/analyze-upload",
    uploadIngest.single("file"),
    async (req: Request, res: Response) => {
      if (!projectApiRateLimiter()) {
        return res.status(429).json({ error: "Rate limit exceeded" });
      }
      if (!requireAuth(req, res)) return;
      const file = req.file;
      if (!file?.path) {
        return res.status(400).json({ message: "file required (multipart field: file)" });
      }
      const kind = String(req.body?.kind || "");
      const name = typeof req.body?.name === "string" ? req.body.name : "Uploaded import";
      const reportAudience = req.body?.reportAudience === "learner" ? "learner" : "pro";
      let prepared;
      try {
        if (kind === "zip") {
          prepared = await ingest({ type: "zip", filePath: file.path });
        } else if (kind === "audio") {
          prepared = await ingest({ type: "audio", filePath: file.path });
        } else {
          await fs.unlink(file.path).catch(() => {});
          return res.status(400).json({ message: 'kind must be "zip" or "audio"' });
        }
      } catch (err: any) {
        await fs.unlink(file.path).catch(() => {});
        return res.status(400).json({ message: err?.message || "ingest failed" });
      }
      await fs.unlink(file.path).catch(() => {});
      const project = await storage.createProject(
        {
          url: kind === "audio" ? `audio:${name}` : `zip:${name}`,
          name,
          reportAudience,
        },
        "local",
      );
      runAnalysis(project.id, prepared.localPath, "local", sidecarFromIngestResult(prepared));
      res.status(202).json({ ok: true, projectId: project.id, detected: prepared.inputType });
    },
  );

  app.get("/api/projects/:projectId/runs", async (req: Request, res: Response) => {
    if (!projectApiRateLimiter()) {
      return res.status(429).json({ error: "Rate limit exceeded" });
    }
    if (!requireAuth(req, res)) return;
    const projectId = Number(req.params.projectId);
    const rows = await storage.listRunsForProject(projectId);
    res.json(
      rows.map((r) => ({
        id: r.id,
        created_at: r.createdAt,
        mode: r.mode,
        dci_score: r.dciScore,
        claim_count: r.claimCount,
        verified_count: r.verifiedCount,
        input_type: r.inputType,
        model_used: r.modelUsed,
        cache_hit: Boolean(r.runMetadata && (r.runMetadata as any).cache_hit),
      })),
    );
  });

  app.get("/api/projects/:projectId/runs/:runId", async (req: Request, res: Response) => {
    if (!projectApiRateLimiter()) {
      return res.status(429).json({ error: "Rate limit exceeded" });
    }
    if (!requireAuth(req, res)) return;
    const projectId = Number(req.params.projectId);
    const runId = Number(req.params.runId);
    const run = await storage.getProjectRun(projectId, runId);
    if (!run) {
      return res.status(404).json({ message: "Run not found" });
    }
    const analysis =
      run.analysisId != null ? await storage.getAnalysisById(run.analysisId) : undefined;
    res.json({ run, analysis });
  });

  app.post(
    "/api/ingest/audio",
    uploadIngest.single("file"),
    async (req: Request, res: Response) => {
      if (!projectApiRateLimiter()) {
        return res.status(429).json({ error: "Rate limit exceeded" });
      }
      if (!requireAuth(req, res)) return;
      const file = req.file;
      if (!file?.path) {
        return res.status(400).json({ message: "file required (multipart field: file)" });
      }
      try {
        const { transcribeAudio, sha256File } = await import("./ingestion/audio_ingest");
        const [transcript, audioHash] = await Promise.all([
          transcribeAudio(file.path),
          sha256File(file.path),
        ]);
        await fs.unlink(file.path).catch(() => {});
        const repoUrl = typeof req.body?.repoUrl === "string" ? req.body.repoUrl : undefined;
        let jobId: string | null = null;
        if (repoUrl?.trim()) {
          logEvent(0, "ingest_audio_repo_pending", { repoUrl });
        }
        res.json({ transcript, audioHash, jobId });
      } catch (err: any) {
        await fs.unlink(file.path).catch(() => {});
        res.status(400).json({ message: err?.message || "transcription failed" });
      }
    },
  );

  app.get(
    "/api/projects/:projectId/runs/:runId/diff/:prevRunId",
    async (req: Request, res: Response) => {
      if (!projectApiRateLimiter()) {
        return res.status(429).json({ error: "Rate limit exceeded" });
      }
      if (!requireAuth(req, res)) return;
      const projectId = Number(req.params.projectId);
      const runId = Number(req.params.runId);
      const prevRunId = Number(req.params.prevRunId);
      const cur = await storage.getProjectRun(projectId, runId);
      const prev = await storage.getProjectRun(projectId, prevRunId);
      if (!cur?.analysisId || !prev?.analysisId) {
        return res.status(404).json({ message: "Run or linked analysis not found" });
      }
      const aAfter = await storage.getAnalysisById(cur.analysisId);
      const aBefore = await storage.getAnalysisById(prev.analysisId);
      if (!aAfter?.dossier || !aBefore?.dossier) {
        return res.status(400).json({ message: "Dossier not available for diff" });
      }
      const redAfter = dossierRedLines(aAfter.dossier);
      const redBefore = dossierRedLines(aBefore.dossier);
      const newIssues = [...redAfter].filter((x) => !redBefore.has(x));
      const resolvedIssues = [...redBefore].filter((x) => !redAfter.has(x));
      const depsAfter = new Set(depNames(aAfter.dependencyGraph));
      const depsBefore = new Set(depNames(aBefore.dependencyGraph));
      const newDependencies = [...depsAfter].filter((d) => !depsBefore.has(d));
      const removedDependencies = [...depsBefore].filter((d) => !depsAfter.has(d));
      const epAfter = new Set(openEndpointLabels(aAfter.apiSurface));
      const epBefore = new Set(openEndpointLabels(aBefore.apiSurface));
      const newOpenEndpoints = [...epAfter].filter((e) => !epBefore.has(e));
      const resolvedOpenEndpoints = [...epBefore].filter((e) => !epAfter.has(e));
      const dciDelta = (cur.dciScore ?? 0) - (prev.dciScore ?? 0);
      const summary = summarizeRunDiff(dciDelta, newIssues.length, resolvedIssues.length);
      res.json({
        dciDelta: Math.round(dciDelta * 1000) / 1000,
        newIssues,
        resolvedIssues,
        newDependencies,
        removedDependencies,
        newOpenEndpoints,
        resolvedOpenEndpoints,
        summary,
      });
    },
  );

  startWorkerLoop();

  return httpServer;
}

function dossierRedLines(md: string): Set<string> {
  const s = new Set<string>();
  for (const line of md.split("\n")) {
    const t = line.trim();
    if (t.includes("🔴")) s.add(t);
  }
  return s;
}

function depNames(graph: unknown): string[] {
  if (!graph || typeof graph !== "object") return [];
  const g = graph as Record<string, unknown>;
  const list = (g.dependencies ?? g.packages ?? g.direct_dependencies ?? g.nodes) as unknown;
  if (!Array.isArray(list)) return [];
  return list
    .map((d: any) => (d && (d.name || d.package || d.purl)) as string)
    .filter(Boolean);
}

function openEndpointLabels(surface: unknown): string[] {
  if (!surface || typeof surface !== "object") return [];
  const s = surface as Record<string, unknown>;
  const eps = (s.endpoints ?? s.http_endpoints ?? s.routes ?? s.paths) as unknown;
  if (!Array.isArray(eps)) return [];
  return eps
    .filter((e: any) => e?.open === true || String(e?.exposure || "").toLowerCase() === "public")
    .map((e: any) => String(e?.path || e?.route || e?.pattern || e?.method || "endpoint"))
    .filter(Boolean);
}

function summarizeRunDiff(dciDelta: number, newCt: number, resolvedCt: number): string {
  if (dciDelta > 0 && newCt === 0 && resolvedCt > 0) {
    return `DCI improved by ${(dciDelta * 100).toFixed(1)} percentage points; ${resolvedCt} prior critical-style issue(s) no longer appear.`;
  }
  if (dciDelta < 0 || newCt > 0) {
    return `DCI changed by ${(dciDelta * 100).toFixed(1)} percentage points with ${newCt} newly flagged item(s) and ${resolvedCt} resolved.`;
  }
  return `DCI delta ${(dciDelta * 100).toFixed(1)} percentage points; ${newCt} new and ${resolvedCt} resolved 🔴 items in the dossier.`;
}

// Validate repository URL to prevent injection attacks
function isValidRepositoryUrl(url: string, mode: string): boolean {
  if (!url || typeof url !== "string") {
    return false;
  }

  // For replit mode, validate as a file path
  if (mode === "replit") {
    // Must be an absolute path and should not contain suspicious characters
    // Escape special regex characters properly
    const suspiciousPatterns = /[;&|`$(){}[\]<>]/;
    return path.isAbsolute(url) && !suspiciousPatterns.test(url);
  }

  // Clone-from-URL analysis (e.g. Replit .git); URL must match a known safe pattern
  if (mode === "git_clone") {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") return false;
      const m = matchCloneAnalyzeUrl(url);
      return m !== null && m.cloneUrl === url;
    } catch {
      return false;
    }
  }

  if (mode === "local") {
    const suspiciousPatterns = /[;&|`$()<>]/;
    return path.isAbsolute(url) && !suspiciousPatterns.test(url);
  }

  // For github mode, validate as a GitHub URL
  try {
    const parsed = new URL(url);
    // Only allow https protocol
    if (parsed.protocol !== "https:") {
      return false;
    }
    // Only allow github.com domain
    if (parsed.hostname !== "github.com") {
      return false;
    }
    // Validate format: https://github.com/owner/repo
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    if (pathParts.length < 2) {
      return false;
    }
    // Check for suspicious characters in owner/repo names
    // Escape special regex characters properly
    const suspiciousPatterns = /[;&|`$(){}[\]<>]/;
    return !pathParts.some(part => suspiciousPatterns.test(part));
  } catch {
    return false;
  }
}

function createRateLimiter(maxRequests: number, windowMs: number) {
  // Check if rate limiting should be disabled for tests
  const isTestMode = process.env.NODE_ENV === "test" || 
                     process.env.ENV === "TEST" ||
                     process.env.DISABLE_RATE_LIMITS === "1";
  
  if (isTestMode) {
    // In test mode, always allow requests
    return () => true;
  }
  
  const timestamps: number[] = [];
  return () => {
    const now = Date.now();
    while (timestamps.length > 0 && timestamps[0] < now - windowMs) {
      timestamps.shift();
    }
    if (timestamps.length >= maxRequests) return false;
    timestamps.push(now);
    return true;
  };
}

async function runAnalysis(projectId: number, source: string, mode: string, sidecar?: IngestSidecar) {
  if (sidecar) {
    ingestSidecarByProject.set(projectId, sidecar);
  }
  const releaseIngestTemp = async () => {
    const sc = ingestSidecarByProject.get(projectId);
    ingestSidecarByProject.delete(projectId);
    if (sc?.cleanup) {
      await sc.cleanup().catch(() => {});
    }
  };

  const startTime = Date.now();
  const projectRow = await storage.getProject(projectId);
  const reportAudience = projectRow?.reportAudience === "learner" ? "learner" : "pro";
  console.log(`[Analyzer ${projectId}] Starting: mode=${mode} source=${source} audience=${reportAudience}`);
  logEvent(projectId, "start", { mode, source, reportAudience });
  await storage.updateProjectStatus(projectId, "analyzing");

  const outputDir = path.resolve(process.cwd(), "out", String(projectId));
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  const analyzeTarget = source;

  let finished = false;
  const finishOnce = async (status: "completed" | "failed", reason?: string) => {
    if (finished) return;
    finished = true;
    const durationMs = Date.now() - startTime;
    const msg = `[Analyzer ${projectId}] Finalized: status=${status} duration=${durationMs}ms${reason ? ` reason=${reason}` : ""}`;
    if (status === "failed") console.error(msg);
    else console.log(msg);
    logEvent(projectId, "finalize", { status, reason, durationMs });
    await storage.updateProjectStatus(projectId, status);
  };

  let contentHashKey: string | undefined;
  if (mode === "local") {
    try {
      contentHashKey = await computeContentHash(analyzeTarget);
      const cached = await getCachedRun(contentHashKey);
      if (cached) {
        const ingestMeta = ingestSidecarByProject.get(projectId);
        let learnerReport = cached.learnerReport;
        if (ingestMeta?.inputType === "audio" && learnerReport) {
          learnerReport = LEARNER_AUDIO_BANNER + learnerReport;
        }
        const analysis = await storage.createAnalysis({
          projectId,
          dossier: cached.dossier,
          claims: cached.claims as any,
          howto: cached.howto as any,
          operate: cached.operate as any,
          coverage: cached.coverage as any,
          unknowns: (cached.unknowns as any) || [],
          dependencyGraph: cached.dependencyGraph as Record<string, unknown> | null,
          apiSurface: cached.apiSurface as Record<string, unknown> | null,
          learnerReport,
          inputType: ingestMeta?.inputType ?? null,
        });
        await storage.insertRun({
          projectId,
          mode: reportAudience,
          inputType: ingestMeta?.inputType ?? "local",
          dciScore: cached.dciScore,
          claimCount: cached.claimCount,
          verifiedCount: cached.verifiedCount,
          openEndpointCount: cached.openEndpointCount,
          criticalIssueCount: cached.criticalIssueCount,
          dependencyCount: cached.dependencyCount,
          flaggedDependencyCount: cached.flaggedDependencyCount,
          runDir: cached.runDir,
          receiptHash: cached.receiptHash,
          modelUsed: process.env.DEBRIEF_ANALYZER_MODEL || undefined,
          runMetadata: {
            branch: ingestMeta?.branch,
            commitHash: ingestMeta?.commitHash,
            inputTypeDetail: ingestMeta?.inputTypeDetail,
            analysisMode: ingestMeta?.analysisMode,
            warnings: ingestMeta?.warnings,
            cache_hit: true,
            content_hash: contentHashKey,
          },
          analysisId: analysis.id,
        });
        logEvent(projectId, "cache_hit", { content_hash: contentHashKey });
        await finishOnce("completed");
        await releaseIngestTemp();
        return;
      }
    } catch (err: any) {
      logEvent(projectId, "cache_lookup_failed", { error: String(err?.message || err) });
    }
  }

  const pythonBin = process.env.PYTHON_EXEC_PATH || "python3";
  const pythonExists = pythonBin.startsWith("/")
    ? existsSync(pythonBin)
    : true; // bare command, trust PATH resolution

  if (!pythonExists) {
    logEvent(projectId, "fatal", { reason: "python_not_found", path: pythonBin });
    await finishOnce("failed", "python_not_found");
    await releaseIngestTemp();
    return;
  }

  const args = ["-m", "server.analyzer.analyzer_cli", "analyze"];

  if (mode === "replit") {
    args.push("--replit");
  } else {
    args.push(analyzeTarget);
  }

  args.push("--output-dir", outputDir);
  if (reportAudience === "learner") {
    args.push("--mode", "learner");
  }

  const cmd = `${pythonBin} ${args.join(" ")}`;
  console.log(`[Analyzer ${projectId}] Executing: ${cmd}`);
  logEvent(projectId, "spawn", { cmd });

  const pythonProcess = spawn(pythonBin, args, {
    cwd: process.cwd(),
    env: { ...process.env },
  });

  const timeout = setTimeout(() => {
    if (finished) return;
    console.error(`[Analyzer ${projectId}] Timeout after 10 minutes — killing`);
    pythonProcess.kill("SIGKILL");
    void finishOnce("failed", "timeout_10m");
  }, Number(process.env.ANALYZER_TIMEOUT_MS) || 10 * 60 * 1000);

  let stdout = "";
  let stderr = "";

  pythonProcess.stdout.on("data", (data) => {
    stdout += data.toString();
    console.log(`[Analyzer ${projectId}]: ${data}`);
  });

  pythonProcess.stderr.on("data", (data) => {
    stderr += data.toString();
    console.error(`[Analyzer ${projectId} ERR]: ${data}`);
  });

  pythonProcess.on("error", (err) => {
    clearTimeout(timeout);
    void releaseIngestTemp();
    console.error(`[Analyzer ${projectId}] Spawn error:`, err);
    logEvent(projectId, "spawn_error", { error: String(err) });
    void finishOnce("failed", "spawn_error");
  });

  pythonProcess.on("close", async (code) => {
    clearTimeout(timeout);
    try {
    if (finished) return;
    logEvent(projectId, "exit", { code });
    console.log(`[Analyzer ${projectId}] Exited code=${code}`);

    if (code === 0) {
      try {
        const runDir = await getLatestAnalyzerRunDir(outputDir);
        if (!runDir) {
          logEvent(projectId, "missing_artifact", { artifact: "runs/<run-id>" });
          await finishOnce("failed", "missing_run_dir");
          return;
        }

        const ingestMeta = ingestSidecarByProject.get(projectId);

        const requiredArtifacts = ["operate.json", "DOSSIER.md", "claims.json"];
        for (const artifact of requiredArtifacts) {
          if (!existsSync(path.join(runDir, artifact))) {
            logEvent(projectId, "missing_artifact", { artifact, runDir });
            await finishOnce("failed", `missing_artifact:${artifact}`);
            return;
          }
        }

        const dossierPath = path.join(runDir, "DOSSIER.md");
        const claimsPath = path.join(runDir, "claims.json");
        const howtoPath = path.join(runDir, "target_howto.json");
        const operatePath = path.join(runDir, "operate.json");
        const coveragePath = path.join(runDir, "coverage.json");

        const dossier = await fs.readFile(dossierPath, "utf-8").catch(() => "");
        
        // Safe JSON parsing with error handling
        let claims = {};
        try {
          const claimsContent = await fs.readFile(claimsPath, "utf-8").catch(() => "{}");
          claims = JSON.parse(claimsContent);
        } catch (err) {
          console.error(`[Analyzer ${projectId}] Failed to parse claims.json:`, err);
          logEvent(projectId, "parse_error", { file: "claims.json" });
        }
        
        let howto: any = {};
        try {
          const howtoContent = await fs.readFile(howtoPath, "utf-8").catch(() => "{}");
          howto = JSON.parse(howtoContent);
        } catch (err) {
          console.error(`[Analyzer ${projectId}] Failed to parse target_howto.json:`, err);
          logEvent(projectId, "parse_error", { file: "target_howto.json" });
        }
        
        let operate: any = null;
        try {
          const operateContent = await fs.readFile(operatePath, "utf-8");
          operate = JSON.parse(operateContent);
        } catch (err) {
          console.error(`[Analyzer ${projectId}] Failed to parse operate.json:`, err);
          logEvent(projectId, "parse_error", { file: "operate.json" });
          operate = null;
        }
        
        let coverage = {};
        try {
          const coverageContent = await fs.readFile(coveragePath, "utf-8").catch(() => "{}");
          coverage = JSON.parse(coverageContent);
        } catch (err) {
          console.error(`[Analyzer ${projectId}] Failed to parse coverage.json:`, err);
          logEvent(projectId, "parse_error", { file: "coverage.json" });
        }

        let dependencyGraph: unknown = null;
        try {
          const dgPath = path.join(runDir, "dependency_graph.json");
          if (existsSync(dgPath)) {
            dependencyGraph = JSON.parse(await fs.readFile(dgPath, "utf-8"));
          }
        } catch (err) {
          console.error(`[Analyzer ${projectId}] Failed to parse dependency_graph.json:`, err);
        }

        let apiSurface: unknown = null;
        try {
          const apiPath = path.join(runDir, "api_surface.json");
          if (existsSync(apiPath)) {
            apiSurface = JSON.parse(await fs.readFile(apiPath, "utf-8"));
          }
        } catch (err) {
          console.error(`[Analyzer ${projectId}] Failed to parse api_surface.json:`, err);
        }

        let learnerReport: string | null = null;
        try {
          const learnerPath = path.join(runDir, "LEARNER_REPORT.md");
          if (existsSync(learnerPath)) {
            learnerReport = await fs.readFile(learnerPath, "utf-8");
          }
        } catch {
          learnerReport = null;
        }

        if (ingestMeta?.inputType === "audio" && learnerReport) {
          learnerReport = LEARNER_AUDIO_BANNER + learnerReport;
        }

        const metrics = extractRunSummary(operate, claims, apiSurface, dependencyGraph);
        let receiptHash: string | null = null;
        const receiptPath = path.join(runDir, "receipt.json");
        if (existsSync(receiptPath)) {
          try {
            const rh = await fs.readFile(receiptPath);
            receiptHash = crypto.createHash("sha256").update(rh).digest("hex");
          } catch {
            receiptHash = null;
          }
        }

        const analysis = await storage.createAnalysis({
          projectId,
          dossier,
          claims,
          howto,
          operate,
          coverage,
          unknowns: howto.unknowns || [],
          dependencyGraph: dependencyGraph as Record<string, unknown> | null,
          apiSurface: apiSurface as Record<string, unknown> | null,
          learnerReport,
          inputType: ingestMeta?.inputType ?? null,
        });

        await storage.insertRun({
          projectId,
          mode: reportAudience,
          inputType: ingestMeta?.inputType ?? mode,
          dciScore: metrics.dciScore ?? undefined,
          claimCount: metrics.claimCount ?? undefined,
          verifiedCount: metrics.verifiedCount ?? undefined,
          openEndpointCount: metrics.openEndpointCount ?? undefined,
          criticalIssueCount: metrics.criticalIssueCount ?? undefined,
          dependencyCount: metrics.dependencyCount ?? undefined,
          flaggedDependencyCount: metrics.flaggedDependencyCount ?? undefined,
          runDir,
          receiptHash,
          modelUsed: process.env.DEBRIEF_ANALYZER_MODEL || undefined,
          runMetadata: {
            branch: ingestMeta?.branch,
            commitHash: ingestMeta?.commitHash,
            inputTypeDetail: ingestMeta?.inputTypeDetail,
            analysisMode: ingestMeta?.analysisMode,
            warnings: ingestMeta?.warnings,
            cache_hit: false,
            content_hash: contentHashKey,
          },
          analysisId: analysis.id,
        });

        if (contentHashKey) {
          try {
            await setCachedRun(
              contentHashKey,
              buildCachedRunFromArtifacts({
                insertPayload: {
                  dossier,
                  claims,
                  howto,
                  operate,
                  coverage,
                  unknowns: howto.unknowns || [],
                  dependencyGraph: dependencyGraph as Record<string, unknown> | null,
                  apiSurface: apiSurface as Record<string, unknown> | null,
                  learnerReport,
                  inputType: ingestMeta?.inputType ?? null,
                },
                receiptHash,
                runDir,
                metrics,
              }),
            );
          } catch (err: any) {
            logEvent(projectId, "cache_set_failed", { error: String(err?.message || err) });
          }
        }

        await finishOnce("completed");
      } catch (err) {
        console.error(`[Analyzer ${projectId}] Error saving results:`, err);
        logEvent(projectId, "save_error", { error: String(err) });
        await finishOnce("failed", "save_error");
      }
    } else {
      logEvent(projectId, "nonzero_exit", { code, stderr: stderr.slice(-500) });
      await finishOnce("failed", `exit_code_${code}`);
    }
    } finally {
      await releaseIngestTemp();
    }
  });
}
