import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { matchCloneAnalyzeUrl, normalizeHttpUrl } from "@shared/cloneAnalyzeUrl";
import { runGitClone } from "./git-clone";
import { readGitMeta } from "./git-meta";
import type { AnalysisMode, IngestInput, IngestManifestDisk, IngestResult } from "./types";
import { fetchNotionPublicAsPlainText } from "./notion-fetch";
import { buildUrlSurfaceWorkspace } from "./url-surface";
import { writeAudioIngestArtifacts } from "./audio_ingest";
import { registerTempDir } from "./cleanup-registry";
import { extractZipToDir, findProjectRoot } from "./zip-utils";

async function mkWorkDir(prefix: string): Promise<{ dir: string; dispose: () => Promise<void> }> {
  const base = process.env.CI_TMP_DIR || os.tmpdir();
  const dir = await fs.mkdtemp(path.join(base, prefix));
  const dispose = registerTempDir(dir);
  return { dir, dispose };
}

async function assertDir(p: string): Promise<void> {
  const st = await fs.stat(p);
  if (!st.isDirectory()) throw new Error("Path is not a directory");
}

export async function assertLocalPathAllowedForIngest(absPath: string): Promise<void> {
  const resolved = path.resolve(absPath);
  await assertDir(resolved);
  if (process.env.NODE_ENV === "production" && process.env.DEBRIEF_ALLOW_LOCAL_PATHS !== "1") {
    throw new Error(
      "Analyzing a raw folder path is disabled in this deployment — upload a .zip or use a git URL.",
    );
  }
}

function parseGitRemote(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }
  if (u.protocol !== "https:") {
    throw new Error("Only https git URLs are supported for this ingest path");
  }
  return u;
}

async function writeManifest(localPath: string, disk: IngestManifestDisk): Promise<void> {
  await fs.writeFile(path.join(localPath, "ingest_manifest.json"), JSON.stringify(disk, null, 2), "utf8");
}

function nowIso() {
  return new Date().toISOString();
}

async function afterGitClone(
  dest: string,
  inputType: string,
  detailPrefix: string,
  sourceUrl: string,
  analysisMode: AnalysisMode,
  warnings: string[],
  dispose: () => Promise<void>,
): Promise<IngestResult> {
  const { commitHash, branch } = await readGitMeta(dest);
  const inputTypeDetail = `${detailPrefix}:${branch}`;
  await writeManifest(dest, {
    input_type: inputType,
    input_type_detail: inputTypeDetail,
    source_url: sourceUrl,
    commit_hash: commitHash,
    branch,
    analysis_mode: analysisMode,
    ingested_at: nowIso(),
  });
  return {
    localPath: dest,
    inputType,
    inputTypeDetail,
    commitHash,
    branch,
    sourceUrl,
    analysisMode,
    warnings,
    cleanup: dispose,
  };
}

/** Map stored project / clone URL to a hosted-git ingest (GitHub, GitLab, Bitbucket). */
export function hostedHttpsGitToIngestInput(rawUrl: string): IngestInput {
  const u = new URL(normalizeHttpUrl(rawUrl));
  const host = u.hostname.replace(/^www\./i, "").toLowerCase();
  if (host === "github.com" || host.endsWith(".github.com")) {
    return { type: "github", url: u.href };
  }
  if (host.endsWith("gitlab.com")) {
    return { type: "gitlab", url: u.href };
  }
  if (host === "bitbucket.org") {
    return { type: "bitbucket", url: u.href };
  }
  throw new Error(`Unsupported git host for ingest: ${host}`);
}

/** Single entry: normalize any supported ingest to a local directory for PTA. */
export async function ingest(input: IngestInput): Promise<IngestResult> {
  switch (input.type) {
    case "local": {
      const resolved = path.resolve(input.path);
      await assertLocalPathAllowedForIngest(resolved);
      const inputTypeDetail = `local:${path.basename(resolved)}`;
      await writeManifest(resolved, {
        input_type: input.type,
        input_type_detail: inputTypeDetail,
        analysis_mode: "full",
        ingested_at: nowIso(),
      });
      return {
        localPath: resolved,
        inputType: input.type,
        inputTypeDetail,
        analysisMode: "full",
        warnings: [],
        cleanup: async () => {},
      };
    }

    case "github": {
      parseGitRemote(input.url);
      const { dir: tmp, dispose } = await mkWorkDir("debrief-gh-");
      const dest = path.join(tmp, "repo");
      await runGitClone(input.url, dest);
      return afterGitClone(dest, input.type, "github", input.url, "full", [], dispose);
    }

    case "gitlab":
    case "bitbucket": {
      const u = parseGitRemote(input.url);
      const host = u.hostname.replace(/^www\./, "");
      if (input.type === "gitlab" && !host.includes("gitlab")) {
        throw new Error("GitLab ingest expects a gitlab.com (or GitLab host) https URL.");
      }
      if (input.type === "bitbucket" && !host.endsWith("bitbucket.org")) {
        throw new Error("Bitbucket ingest expects a bitbucket.org https URL.");
      }
      const { dir: tmp, dispose } = await mkWorkDir(`debrief-${input.type}-`);
      const dest = path.join(tmp, "repo");
      await runGitClone(input.url, dest);
      return afterGitClone(dest, input.type, input.type, input.url, "full", [], dispose);
    }

    case "replit": {
      const m = matchCloneAnalyzeUrl(input.url);
      if (!m) {
        throw new Error("Replit ingest needs a supported Replit repl URL (see clone-analyze docs).");
      }
      const { dir: tmp, dispose } = await mkWorkDir("debrief-replit-");
      const dest = path.join(tmp, "repo");
      await runGitClone(m.cloneUrl, dest);
      return afterGitClone(dest, input.type, "replit", m.cloneUrl, "full", [], dispose);
    }

    case "zip": {
      const zipPath = path.resolve(input.filePath);
      const { dir: tmp, dispose } = await mkWorkDir("debrief-zip-");
      await extractZipToDir(zipPath, tmp);
      const root = await findProjectRoot(tmp);
      const inputTypeDetail = "zip:upload";
      const warn: string[] = [];
      if (root !== tmp) {
        warn.push(`(INFERRED) Project root detected at ${path.relative(tmp, root) || "."}`);
      }
      await writeManifest(root, {
        input_type: input.type,
        input_type_detail: inputTypeDetail,
        source_url: zipPath,
        analysis_mode: "full",
        ingested_at: nowIso(),
      });
      return {
        localPath: root,
        inputType: input.type,
        inputTypeDetail,
        sourceUrl: zipPath,
        analysisMode: "full",
        warnings: warn,
        cleanup: dispose,
      };
    }

    case "url": {
      const warnings = [
        "Analyzed from deployed surface only — source code not available. Connect a repo for verified analysis.",
      ];
      const { dir: tmp, dispose } = await mkWorkDir("debrief-url-");
      await buildUrlSurfaceWorkspace(tmp, input.url);
      const inputTypeDetail = "url:surface";
      await writeManifest(tmp, {
        input_type: input.type,
        input_type_detail: inputTypeDetail,
        source_url: input.url,
        analysis_mode: "surface",
        ingested_at: nowIso(),
      });
      return {
        localPath: tmp,
        inputType: input.type,
        inputTypeDetail,
        sourceUrl: input.url,
        analysisMode: "surface",
        warnings,
        cleanup: dispose,
      };
    }

    case "text": {
      const warnings = [
        "Analyzed from text description only — no source code. Connect a repo for verified analysis.",
      ];
      const { dir: tmp, dispose } = await mkWorkDir("debrief-text-");
      const body = [
        "# Project description (pasted text)",
        "",
        "⚠️ **(INFERRED)** No repository was attached.",
        "",
        input.content.trim(),
      ].join("\n");
      await fs.writeFile(path.join(tmp, "description.md"), body, "utf8");
      await writeManifest(tmp, {
        input_type: input.type,
        input_type_detail: "text:paste",
        analysis_mode: "description",
        ingested_at: nowIso(),
      });
      return {
        localPath: tmp,
        inputType: input.type,
        inputTypeDetail: "text:paste",
        analysisMode: "description",
        warnings,
        cleanup: dispose,
      };
    }

    case "notion": {
      const plain = await fetchNotionPublicAsPlainText(input.url);
      const { dir: tmp, dispose } = await mkWorkDir("debrief-notion-");
      const body = [
        "# Notion export (public page, best-effort)",
        "",
        `Source: ${input.url}`,
        "",
        "⚠️ **(INFERRED)** Imported from Notion — verify privacy and completeness.",
        "",
        plain,
      ].join("\n");
      await fs.writeFile(path.join(tmp, "description.md"), body, "utf8");
      await writeManifest(tmp, {
        input_type: input.type,
        input_type_detail: "notion:public",
        source_url: input.url,
        analysis_mode: "description",
        ingested_at: nowIso(),
      });
      return {
        localPath: tmp,
        inputType: input.type,
        inputTypeDetail: "notion:public",
        sourceUrl: input.url,
        analysisMode: "description",
        warnings: [
          "Imported from Notion public page — no source code. Connect a repo for verified analysis.",
        ],
        cleanup: dispose,
      };
    }

    case "audio": {
      const resolved = path.resolve(input.filePath);
      const { dir: tmp, dispose } = await mkWorkDir("debrief-audio-");
      const { audioHash } = await writeAudioIngestArtifacts(tmp, resolved);
      await writeManifest(tmp, {
        input_type: input.type,
        input_type_detail: "audio:upload",
        analysis_mode: "description",
        ingested_at: nowIso(),
      });
      return {
        localPath: tmp,
        inputType: input.type,
        inputTypeDetail: "audio:upload",
        analysisMode: "description",
        sourceUrl: audioHash,
        warnings: [
          "Analyzed from voice transcript only — no source code. Connect a repo for verified analysis.",
        ],
        cleanup: dispose,
      };
    }

    default: {
      const _exhaustive: never = input;
      throw new Error(`Unsupported ingest: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
