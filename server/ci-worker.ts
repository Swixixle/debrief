import { storage } from "./storage";
import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import { existsSync, mkdirSync, statfsSync, realpathSync } from "fs";
import { CI_ERROR_CODES, parseErrorCode } from "./ci-error-codes";

const CI_OUT_BASE = path.resolve(process.cwd(), "out", "ci");

// Repository ingestion limits (DoS controls)
const MAX_REPO_BYTES = parseInt(process.env.MAX_REPO_BYTES || "262144000", 10); // 250 MB
const MAX_FILE_COUNT = parseInt(process.env.MAX_FILE_COUNT || "50000", 10);
const MAX_SINGLE_FILE_BYTES = parseInt(process.env.MAX_SINGLE_FILE_BYTES || "5242880", 10); // 5 MB

function sanitizeGitUrl(url: string): string {
  return url.replace(/\/\/[^@]+@/, "//***@");
}

/**
 * Validate workdir path for security:
 * - Must be under CI_TMP_DIR
 * - No symlinks in path
 * - No ".." escapes
 * 
 * Exported for testing.
 */
export function validateWorkdir(workDir: string): 
  | { valid: true } 
  | { valid: false; error: string; errorCode: string } {
  const tmpBase = getCiTmpDir();
  
  try {
    // Resolve to real path and check containment
    const realWorkDir = realpathSync(workDir);
    const realTmpBase = realpathSync(tmpBase);
    
    // Ensure workdir is under tmpBase
    if (!realWorkDir.startsWith(realTmpBase + path.sep) && realWorkDir !== realTmpBase) {
      return {
        valid: false,
        errorCode: CI_ERROR_CODES.WORKDIR_ESCAPE,
        error: `${CI_ERROR_CODES.WORKDIR_ESCAPE}: ${workDir} is not under ${tmpBase}`
      };
    }
    
    // Check for ".." in relative path
    const relPath = path.relative(tmpBase, workDir);
    if (relPath.includes("..")) {
      return {
        valid: false,
        errorCode: CI_ERROR_CODES.WORKDIR_ESCAPE,
        error: `${CI_ERROR_CODES.WORKDIR_ESCAPE}: path contains ".." escape`
      };
    }
    
    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      errorCode: CI_ERROR_CODES.WORKDIR_INVALID,
      error: `${CI_ERROR_CODES.WORKDIR_INVALID}: ${err}`
    };
  }
}

/**
 * Check repository size limits (DoS controls).
 * Returns error if limits exceeded.
 */
async function validateRepoLimits(repoDir: string): Promise<{ valid: boolean; error?: string; errorCode?: string }> {
  try {
    let totalBytes = 0;
    let fileCount = 0;
    
    const walk = async (dir: string): Promise<boolean> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        // Skip .git to avoid counting pack files
        if (entry.name === ".git") continue;
        
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isSymbolicLink()) {
          // Skip symlinks for security
          continue;
        }
        
        if (entry.isDirectory()) {
          const result = await walk(fullPath);
          if (!result) return false;
        } else if (entry.isFile()) {
          fileCount++;
          
          if (fileCount > MAX_FILE_COUNT) {
            console.warn(`[validateRepoLimits] Too many files: ${fileCount} > ${MAX_FILE_COUNT} in ${dir}`);
            return false;
          }
          
          const stats = await fs.stat(fullPath);
          
          if (stats.size > MAX_SINGLE_FILE_BYTES) {
            console.warn(`[validateRepoLimits] File too large: ${fullPath} (${stats.size} bytes)`);
            return false;
          }
          
          totalBytes += stats.size;
          
          if (totalBytes > MAX_REPO_BYTES) {
            console.warn(`[validateRepoLimits] Total size exceeded: ${totalBytes} > ${MAX_REPO_BYTES}`);
            return false;
          }
        }
      }
      
      return true;
    };
    
    const ok = await walk(repoDir);
    
    if (!ok) {
      if (fileCount > MAX_FILE_COUNT) {
        return {
          valid: false,
          errorCode: CI_ERROR_CODES.TOO_MANY_FILES,
          error: `${CI_ERROR_CODES.TOO_MANY_FILES}: ${fileCount} files exceeds limit ${MAX_FILE_COUNT}`
        };
      }
      if (totalBytes > MAX_REPO_BYTES) {
        return {
          valid: false,
          errorCode: CI_ERROR_CODES.REPO_TOO_LARGE,
          error: `${CI_ERROR_CODES.REPO_TOO_LARGE}: ${totalBytes} bytes exceeds limit ${MAX_REPO_BYTES}`
        };
      }
      return {
        valid: false,
        errorCode: CI_ERROR_CODES.FILE_TOO_LARGE,
        error: `${CI_ERROR_CODES.FILE_TOO_LARGE}: single file exceeds limit ${MAX_SINGLE_FILE_BYTES}`
      };
    }
    
    console.log(`[CI Worker] Repo validated: ${fileCount} files, ${totalBytes} bytes`);
    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      errorCode: CI_ERROR_CODES.UNKNOWN_ERROR,
      error: `${CI_ERROR_CODES.UNKNOWN_ERROR}: repo validation error: ${err}`
    };
  }
}

function checkDiskSpace(dir: string): { freeBytes: number; lowDisk: boolean } {
  try {
    const stats = statfsSync(dir);
    const freeBytes = stats.bfree * stats.bsize;
    const totalBytes = stats.blocks * stats.bsize;
    const freePercent = totalBytes > 0 ? (freeBytes / totalBytes) * 100 : 100;
    const LOW_DISK_BYTES = 1024 * 1024 * 1024;
    const LOW_DISK_PERCENT = 5;
    return {
      freeBytes,
      lowDisk: freeBytes < LOW_DISK_BYTES || freePercent < LOW_DISK_PERCENT,
    };
  } catch {
    return { freeBytes: -1, lowDisk: false };
  }
}

export function getCiTmpDir(): string {
  return path.resolve(process.env.CI_TMP_DIR || "/tmp/ci");
}

export function getDiskStatus(): { ciTmpDir: string; ciTmpDirFreeBytes: number; ciTmpDirLowDisk: boolean } {
  const tmpDir = getCiTmpDir();
  mkdirSync(tmpDir, { recursive: true });
  const { freeBytes, lowDisk } = checkDiskSpace(tmpDir);
  return {
    ciTmpDir: tmpDir,
    ciTmpDirFreeBytes: freeBytes,
    ciTmpDirLowDisk: lowDisk,
  };
}

export async function processOneJob(): Promise<{ processed: boolean; runId?: string; status?: string }> {
  const leased = await storage.leaseNextJob();
  if (!leased) return { processed: false };

  const { job, run } = leased;
  console.log(`[CI Worker] Leased job=${job.id} run=${run.id} repo=${run.repoOwner}/${run.repoName} sha=${run.commitSha}`);

  const outDir = path.join(CI_OUT_BASE, run.id);
  mkdirSync(outDir, { recursive: true });

  const tmpBase = getCiTmpDir();
  mkdirSync(tmpBase, { recursive: true });

  const { lowDisk } = checkDiskSpace(tmpBase);
  if (lowDisk) {
    const errMsg = `${CI_ERROR_CODES.LOW_DISK_SPACE}: ci_tmp_dir_low_disk`;
    const errorCode = CI_ERROR_CODES.LOW_DISK_SPACE;
    console.error(`[CI Worker] Low disk space in ${tmpBase}, failing job`);
    await storage.updateCiRun(run.id, {
      status: "FAILED",
      finishedAt: new Date(),
      error: errMsg,
      errorCode,
    });
    await storage.completeJob(job.id, "DEAD", errMsg);
    return { processed: true, runId: run.id, status: "FAILED" };
  }

  const runWorkDir = path.join(tmpBase, `run-${run.id}`);
  let tmpDir: string | null = null;
  try {
    await fs.mkdir(runWorkDir, { recursive: true });
    
    // SECURITY: Validate workdir containment
    const workdirCheck = validateWorkdir(runWorkDir);
    if (!workdirCheck.valid) {
      const errMsg = workdirCheck.error || "workdir_validation_failed";
      const errorCode = workdirCheck.errorCode || CI_ERROR_CODES.WORKDIR_INVALID;
      console.error(`[CI Worker] Workdir validation failed: ${errMsg}`);
      await storage.updateCiRun(run.id, {
        status: "FAILED",
        finishedAt: new Date(),
        error: errMsg,
        errorCode,
      });
      await storage.completeJob(job.id, "DEAD", errMsg);
      return { processed: true, runId: run.id, status: "FAILED" };
    }
    
    tmpDir = await fetchRepo(run.repoOwner, run.repoName, run.commitSha, runWorkDir);
    
    // SECURITY: Validate repo size limits
    const limitsCheck = await validateRepoLimits(tmpDir);
    if (!limitsCheck.valid) {
      const errMsg = limitsCheck.error || "repo_limits_exceeded";
      const errorCode = limitsCheck.errorCode || CI_ERROR_CODES.REPO_TOO_LARGE;
      console.error(`[CI Worker] Repo limits check failed: ${errMsg}`);
      await storage.updateCiRun(run.id, {
        status: "FAILED",
        finishedAt: new Date(),
        error: errMsg,
        errorCode,
      });
      await storage.completeJob(job.id, "DEAD", errMsg);
      return { processed: true, runId: run.id, status: "FAILED" };
    }
    
    const result = await runAnalyzerOnDir(tmpDir, outDir, run.id);

    if (result.success) {
      await storage.updateCiRun(run.id, {
        status: "SUCCEEDED",
        finishedAt: new Date(),
        outDir: `out/ci/${run.id}`,
        summaryJson: result.summary || null,
      });
      await storage.completeJob(job.id, "DONE");
      console.log(`[CI Worker] Run ${run.id} SUCCEEDED`);
      return { processed: true, runId: run.id, status: "SUCCEEDED" };
    } else {
      const errorMsg = result.error || "unknown_error";
      const errorCode = parseErrorCode(errorMsg);
      await storage.updateCiRun(run.id, {
        status: "FAILED",
        finishedAt: new Date(),
        error: errorMsg,
        errorCode,
        outDir: `out/ci/${run.id}`,
      });
      await storage.completeJob(job.id, "DONE", result.error);
      console.log(`[CI Worker] Run ${run.id} FAILED: ${result.error}`);
      return { processed: true, runId: run.id, status: "FAILED" };
    }
  } catch (err: any) {
    const errMsg = sanitizeGitUrl(String(err?.message || err));
    const errorCode = parseErrorCode(errMsg);
    console.error(`[CI Worker] Job ${job.id} exception:`, errMsg);

    if (job.attempts >= 3) {
      await storage.updateCiRun(run.id, {
        status: "FAILED",
        finishedAt: new Date(),
        error: `${CI_ERROR_CODES.MAX_ATTEMPTS_EXCEEDED}: ${errMsg}`,
        errorCode: CI_ERROR_CODES.MAX_ATTEMPTS_EXCEEDED,
      });
      await storage.completeJob(job.id, "DEAD", errMsg);
    } else {
      await storage.completeJob(job.id, "DEAD", errMsg);
    }
    return { processed: true, runId: run.id, status: "FAILED" };
  } finally {
    const preserve = process.env.CI_PRESERVE_WORKDIR === "true";
    if (!preserve && runWorkDir) {
      await fs.rm(runWorkDir, { recursive: true, force: true }).catch(() => {});
    } else if (preserve) {
      console.log(`[CI Worker] Preserving workspace: ${runWorkDir}`);
    }
  }
}

async function fetchRepo(owner: string, repo: string, sha: string, workDir: string): Promise<string> {
  const repoDir = path.join(workDir, "repo");
  await fs.mkdir(repoDir, { recursive: true });

  const token = process.env.GITHUB_TOKEN;
  const publicUrl = `https://github.com/${owner}/${repo}.git`;
  let cloneUrl = publicUrl;
  if (token) {
    cloneUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  }

  console.log(`[CI Worker] Cloning ${owner}/${repo}@${sha}`);

  await execCommand("git", ["clone", "--depth", "1", cloneUrl, repoDir]);
  await execCommand("git", ["-C", repoDir, "fetch", "--depth", "1", "origin", sha]);
  await execCommand("git", ["-C", repoDir, "checkout", sha]);

  return repoDir;
}

function execCommand(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const safeArgs = args.map((a) => sanitizeGitUrl(a));
    const proc = spawn(cmd, args, { 
      cwd: process.cwd(),
      shell: false  // SECURITY: Never use shell execution
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", (err) => {
      reject(new Error(`${cmd} ${safeArgs.join(" ")} error: ${sanitizeGitUrl(String(err))}`));
    });
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} ${safeArgs.join(" ")} exited with code ${code}: ${sanitizeGitUrl(stderr.slice(-500))}`));
    });
  });
}

async function runAnalyzerOnDir(
  repoDir: string,
  outDir: string,
  runId: string
): Promise<{ success: boolean; error?: string; errorCode?: string; summary?: any }> {
  const pythonBin = process.env.PYTHON_EXEC_PATH || "python3";
  if (!existsSync(pythonBin)) {
    return { 
      success: false, 
      errorCode: CI_ERROR_CODES.PYTHON_NOT_FOUND,
      error: `${CI_ERROR_CODES.PYTHON_NOT_FOUND}: python interpreter not found at ${pythonBin}` 
    };
  }

  const args = ["-m", "server.analyzer.analyzer_cli", "analyze", repoDir, "--output-dir", outDir];
  console.log(`[CI Worker] Running analyzer for run=${runId}`);
  
  // Use consistent timeout value
  const timeoutMs = Number(process.env.ANALYZER_TIMEOUT_MS) || 10 * 60 * 1000;

  return new Promise((resolve) => {
    let stderr = "";
    const proc = spawn(pythonBin, args, {
      cwd: process.cwd(),
      env: { ...process.env },
      shell: false  // SECURITY: Never use shell execution
    });

    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve({ 
        success: false, 
        errorCode: CI_ERROR_CODES.ANALYZER_TIMEOUT,
        error: `${CI_ERROR_CODES.ANALYZER_TIMEOUT}: exceeded ${timeoutMs}ms` 
      });
    }, timeoutMs);

    proc.stdout.on("data", (d) => {
      console.log(`[CI Analyzer ${runId}]: ${d}`);
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
      console.error(`[CI Analyzer ${runId} ERR]: ${d}`);
    });
    proc.on("error", (err) => {
      clearTimeout(timeout);
      resolve({ 
        success: false, 
        errorCode: CI_ERROR_CODES.ANALYZER_SPAWN_ERROR,
        error: `${CI_ERROR_CODES.ANALYZER_SPAWN_ERROR}: ${err}` 
      });
    });
    proc.on("close", async (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        resolve({ 
          success: false, 
          errorCode: CI_ERROR_CODES.ANALYZER_EXIT_CODE,
          error: `${CI_ERROR_CODES.ANALYZER_EXIT_CODE}: exit code ${code}: ${stderr.slice(-300)}` 
        });
        return;
      }

      try {
        let summary: any = null;
        const operatePath = path.join(outDir, "operate.json");
        if (existsSync(operatePath)) {
          const raw = await fs.readFile(operatePath, "utf-8");
          const op = JSON.parse(raw);
          summary = {
            readiness: op.readiness_scores || null,
            boot_commands: (op.boot_commands || []).length,
            endpoints: (op.integration_points?.endpoints || []).length,
            env_vars: (op.integration_points?.env_vars || []).length,
            gaps: (op.operational_gaps || []).length,
          };
        }
        resolve({ success: true, summary });
      } catch {
        resolve({ success: true, summary: null });
      }
    });
  });
}

let workerInterval: ReturnType<typeof setInterval> | null = null;

export function startWorkerLoop(intervalMs: number = 5000) {
  if (workerInterval) return;
  console.log(`[CI Worker] Starting background loop (every ${intervalMs}ms)`);
  workerInterval = setInterval(async () => {
    try {
      await processOneJob();
    } catch (err) {
      console.error("[CI Worker] Loop error:", err);
    }
  }, intervalMs);
}

export function stopWorkerLoop() {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    console.log("[CI Worker] Stopped background loop");
  }
}
