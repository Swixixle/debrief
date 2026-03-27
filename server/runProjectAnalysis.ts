import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { storage } from "./storage";
import { getLatestAnalyzerRunDir } from "./analyzerRunDir";
import {
  computeContentHash,
  getCachedRun,
  setCachedRun,
  buildCachedRunFromArtifacts,
  type CachedRun,
} from "./cache/run-cache";
import { extractRunSummary } from "./runMetrics";
import { logAnalyzerEvent as logEvent } from "./analyzerLog";

const LEARNER_AUDIO_BANNER =
  "> **Note:** This analysis is based on your voice description, not source code. All claims are INFERRED until you connect a repository.\n\n";

/** Sidecar from ingest — mirrors routes `IngestSidecar`. */
export type AnalyzerIngestMeta = {
  inputType?: string;
  cleanup?: () => Promise<void>;
  inputTypeDetail?: string;
  analysisMode?: string;
  commitHash?: string;
  branch?: string;
  sourceUrl?: string;
  warnings?: string[];
};

export function getAnalyzerOutputDir(projectId: number): string {
  return path.resolve(process.cwd(), "out", String(projectId));
}

export async function applyAnalyzerCacheHit(opts: {
  projectId: number;
  reportAudience: "learner" | "pro";
  ingestMeta?: AnalyzerIngestMeta;
  cached: CachedRun;
  contentHashKey: string;
  modelUsed?: string | null;
}): Promise<{ runDir: string }> {
  const { projectId, reportAudience, ingestMeta, cached, contentHashKey, modelUsed } = opts;
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
    modelUsed: modelUsed ?? process.env.DEBRIEF_ANALYZER_MODEL,
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
  await storage.updateProjectStatus(projectId, "completed");
  if (ingestMeta?.cleanup) {
    await ingestMeta.cleanup().catch(() => {});
  }
  return { runDir: cached.runDir };
}

export type RunProjectAnalysisOptions = {
  projectId: number;
  source: string;
  mode: string;
  ingestMeta?: AnalyzerIngestMeta;
  /** When set, skips loading audience from DB */
  reportAudience?: "learner" | "pro";
  /** Worker already verified cache miss */
  skipCacheCheck?: boolean;
  contentHashPrecomputed?: string;
  modelUsed?: string;
  onProgress?: (pct: number, message: string) => void | Promise<void>;
};

export async function runProjectAnalysis(
  opts: RunProjectAnalysisOptions,
): Promise<{ runDir: string; fromCache: boolean }> {
  const {
    projectId,
    source,
    mode,
    ingestMeta,
    reportAudience: audienceOverride,
    skipCacheCheck,
    contentHashPrecomputed,
    modelUsed,
    onProgress,
  } = opts;

  const emit = async (pct: number, msg: string) => {
    if (onProgress) await onProgress(pct, msg);
  };

  const releaseIngestTemp = async () => {
    if (ingestMeta?.cleanup) {
      await ingestMeta.cleanup().catch(() => {});
    }
  };

  const startTime = Date.now();
  const projectRow = await storage.getProject(projectId);
  const reportAudience: "learner" | "pro" =
    audienceOverride ?? (projectRow?.reportAudience === "learner" ? "learner" : "pro");
  console.log(`[Analyzer ${projectId}] Starting: mode=${mode} source=${source} audience=${reportAudience}`);
  logEvent(projectId, "start", { mode, source, reportAudience });
  await storage.updateProjectStatus(projectId, "analyzing");

  const outputDir = getAnalyzerOutputDir(projectId);
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

  let contentHashKey: string | undefined = contentHashPrecomputed;

  if (mode === "local" && !skipCacheCheck) {
    try {
      contentHashKey = await computeContentHash(analyzeTarget);
      const cached = await getCachedRun(contentHashKey);
      if (cached) {
        await applyAnalyzerCacheHit({
          projectId,
          reportAudience,
          ingestMeta,
          cached,
          contentHashKey,
          modelUsed,
        });
        await finishOnce("completed");
        return { runDir: cached.runDir, fromCache: true };
      }
    } catch (err: any) {
      logEvent(projectId, "cache_lookup_failed", { error: String(err?.message || err) });
    }
  }

  const pythonBin = process.env.PYTHON_EXEC_PATH || "python3";
  const pythonExists = pythonBin.startsWith("/") ? existsSync(pythonBin) : true;

  if (!pythonExists) {
    logEvent(projectId, "fatal", { reason: "python_not_found", path: pythonBin });
    await finishOnce("failed", "python_not_found");
    await releaseIngestTemp();
    throw new Error("python_not_found");
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

  const childEnv = {
    ...process.env,
    ...(modelUsed ? { DEBRIEF_ANALYZER_MODEL: modelUsed } : {}),
  };

  const pythonProcess = spawn(pythonBin, args, {
    cwd: process.cwd(),
    env: childEnv,
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

  try {
    await emit(20, "Reading files…");
    const runDir = await new Promise<string>((resolve, reject) => {
      let settled = false;
      const end = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      pythonProcess.on("error", async (err) => {
        clearTimeout(timeout);
        console.error(`[Analyzer ${projectId}] Spawn error:`, err);
        logEvent(projectId, "spawn_error", { error: String(err) });
        await finishOnce("failed", "spawn_error");
        await releaseIngestTemp();
        end(() => reject(err));
      });

      pythonProcess.on("close", async (code) => {
        clearTimeout(timeout);
        try {
          if (finished) {
            await releaseIngestTemp();
            end(() =>
              reject(
                code !== 0
                  ? new Error(`analyzer stopped after timeout or early finalize (exit ${code})`)
                  : new Error("analyzer already finalized"),
              ),
            );
            return;
          }
          logEvent(projectId, "exit", { code });
          console.log(`[Analyzer ${projectId}] Exited code=${code}`);

          if (code !== 0) {
            logEvent(projectId, "nonzero_exit", { code, stderr: stderr.slice(-500) });
            await finishOnce("failed", `exit_code_${code}`);
            await releaseIngestTemp();
            end(() => reject(new Error(`analyzer exited with code ${code}`)));
            return;
          }

          try {
            await emit(70, "Collecting artifacts…");
            const resolvedRunDir = await getLatestAnalyzerRunDir(outputDir);
            if (!resolvedRunDir) {
              logEvent(projectId, "missing_artifact", { artifact: "runs/<run-id>" });
              await finishOnce("failed", "missing_run_dir");
              await releaseIngestTemp();
              end(() => reject(new Error("missing_run_dir")));
              return;
            }

            const requiredArtifacts = ["operate.json", "DOSSIER.md", "claims.json"];
            for (const artifact of requiredArtifacts) {
              if (!existsSync(path.join(resolvedRunDir, artifact))) {
                logEvent(projectId, "missing_artifact", { artifact, runDir: resolvedRunDir });
                await finishOnce("failed", `missing_artifact:${artifact}`);
                await releaseIngestTemp();
                end(() => reject(new Error(`missing_artifact:${artifact}`)));
                return;
              }
            }

            const dossierPath = path.join(resolvedRunDir, "DOSSIER.md");
            const claimsPath = path.join(resolvedRunDir, "claims.json");
            const howtoPath = path.join(resolvedRunDir, "target_howto.json");
            const operatePath = path.join(resolvedRunDir, "operate.json");
            const coveragePath = path.join(resolvedRunDir, "coverage.json");

            const dossier = await fs.readFile(dossierPath, "utf-8").catch(() => "");

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
              const dgPath = path.join(resolvedRunDir, "dependency_graph.json");
              if (existsSync(dgPath)) {
                dependencyGraph = JSON.parse(await fs.readFile(dgPath, "utf-8"));
              }
            } catch (err) {
              console.error(`[Analyzer ${projectId}] Failed to parse dependency_graph.json:`, err);
            }

            let apiSurface: unknown = null;
            try {
              const apiPath = path.join(resolvedRunDir, "api_surface.json");
              if (existsSync(apiPath)) {
                apiSurface = JSON.parse(await fs.readFile(apiPath, "utf-8"));
              }
            } catch (err) {
              console.error(`[Analyzer ${projectId}] Failed to parse api_surface.json:`, err);
            }

            let learnerReport: string | null = null;
            try {
              const learnerPath = path.join(resolvedRunDir, "LEARNER_REPORT.md");
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
            const receiptPath = path.join(resolvedRunDir, "receipt.json");
            if (existsSync(receiptPath)) {
              try {
                const rh = await fs.readFile(receiptPath);
                receiptHash = crypto.createHash("sha256").update(rh).digest("hex");
              } catch {
                receiptHash = null;
              }
            }

            await emit(85, "Saving report…");
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

            const hashForCache =
              contentHashKey ?? (await computeContentHash(analyzeTarget).catch(() => undefined));

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
              runDir: resolvedRunDir,
              receiptHash,
              modelUsed: modelUsed ?? process.env.DEBRIEF_ANALYZER_MODEL,
              runMetadata: {
                branch: ingestMeta?.branch,
                commitHash: ingestMeta?.commitHash,
                inputTypeDetail: ingestMeta?.inputTypeDetail,
                analysisMode: ingestMeta?.analysisMode,
                warnings: ingestMeta?.warnings,
                cache_hit: false,
                content_hash: hashForCache,
              },
              analysisId: analysis.id,
            });

            if (hashForCache) {
              try {
                await setCachedRun(
                  hashForCache,
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
                    runDir: resolvedRunDir,
                    metrics,
                  }),
                );
              } catch (err: any) {
                logEvent(projectId, "cache_set_failed", { error: String(err?.message || err) });
              }
            }

            await finishOnce("completed");
            end(() => resolve(resolvedRunDir));
          } catch (err: any) {
            console.error(`[Analyzer ${projectId}] Error saving results:`, err);
            logEvent(projectId, "save_error", { error: String(err) });
            await finishOnce("failed", "save_error");
            end(() => reject(err));
          } finally {
            await releaseIngestTemp();
          }
        } catch (outer) {
          await releaseIngestTemp();
          end(() => reject(outer as Error));
        }
      });
    });

    await emit(95, "Done");
    return { runDir, fromCache: false };
  } catch (e) {
    await releaseIngestTemp();
    throw e;
  }
}
