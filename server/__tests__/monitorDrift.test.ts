import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { monitorDrift } from "../claims/monitorDrift";
import { hashClaimExcerpt } from "../claims/hash";
const execFileAsync = promisify(execFile);

describe("monitorDrift", () => {
  let tmp: string;
  let repoPath: string;
  let baselinePath: string;
  let driftOut: string;
  let baselineCommit: string;
  let claimId = "claim1";
  let fingerprint = "fp1";
  let fileRel = "src/a.ts";
  let lineStart = 1;
  let lineEnd = 1;
  let excerptHash: string;

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "reporecon-monitor-"));
    repoPath = tmp;
    await fs.mkdir(path.join(repoPath, "src"), { recursive: true });
    await fs.writeFile(path.join(repoPath, fileRel), "console.log('A');\n");
    await execFileAsync("git", ["init"], { cwd: repoPath });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: repoPath });
    await execFileAsync("git", ["config", "user.name", "test"], { cwd: repoPath });
    await execFileAsync("git", ["add", "src/a.ts"], { cwd: repoPath });
    await execFileAsync("git", ["commit", "-m", "baseline"], { cwd: repoPath });
    baselineCommit = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoPath })).stdout.trim();
    // Compute excerpt hash using real hashClaimExcerpt
    excerptHash = hashClaimExcerpt(path.join(repoPath, fileRel), lineStart, lineEnd).excerptHash;
    // Write baseline dossier
    baselinePath = path.join(tmp, "baseline_dossier.json");
    driftOut = path.join(tmp, "drift_report.json");
    const baselineDossier = {
      schema_version: "dossier_v2",
      generator: {
        name: "Repo Recon",
        version: "1.0.0",
        git_sha: "baseline123",
        build_time: "2026-02-24T00:00:00Z"
      },
      target: {
        repo_url: repoPath,
        commit_sha: baselineCommit,
        default_branch: "main"
      },
      canonicalization_version: "v1",
      hash_algorithm: "sha256",
      hash_encoding: "hex",
      created_at: "2026-02-24T00:00:00Z",
      claims: [
        {
          claim_id: claimId,
          fingerprint,
          epistemic_status: "VERIFIED",
          claim_type: "MODULE_EXISTENCE",
          subject: fileRel,
          summary: "File exists",
          evidence: [
            {
              repo_commit: baselineCommit,
              file: fileRel,
              line_start: lineStart,
              line_end: lineEnd,
              excerpt_hash: excerptHash
            }
          ]
        }
      ],
      scores: {
        confidence_overall: 0.8,
        confidence_weighted: 0.8,
        critical_unknowns: 0,
        core_module_coverage: 0.9
      },
      questions_for_maintainer: [],
      security_warnings: [],
      dossier_hash: "dossierhashA",
      audit_trail: []
    };
    await fs.writeFile(baselinePath, JSON.stringify(baselineDossier, null, 2));
  });

  it("should produce drift report with no changes", async () => {
    // Run monitorDrift
    const nowIso = "2026-02-24T00:00:10Z";
    const report = await monitorDrift({ repoPath, baselinePath, outPath: driftOut, nowIso });
    expect(report.commit_changed).toBe(false);
    expect(report.verified.drifted.length).toBe(0);
    expect(report.verified.invalidated.length).toBe(0);
    expect(report.verified.still_valid.length).toBe(1);
    expect(report.verified.still_valid[0]).toBe(claimId);
    expect(report.time_delta_seconds).toBe(10);
    // Print drift_report.json for acceptance
    const driftJson = await fs.readFile(driftOut, "utf8");
    console.log("DRIFT REPORT JSON:\n", driftJson);
  });

  it("should detect drifted claim when file changes", async () => {
    // Change file
    await fs.writeFile(path.join(repoPath, fileRel), "console.log('B');\n");
    const nowIso = "2026-02-24T00:00:20Z";
    const report = await monitorDrift({ repoPath, baselinePath, outPath: driftOut, nowIso });
    expect(report.verified.drifted.length).toBe(1);
    expect(report.verified.drifted[0].claim_id).toBe(claimId);
    expect(report.verified.invalidated.length).toBe(0);
  });

  it("should detect invalidated claim when file deleted", async () => {
    await fs.rm(path.join(repoPath, fileRel));
    const nowIso = "2026-02-24T00:00:30Z";
    const report = await monitorDrift({ repoPath, baselinePath, outPath: driftOut, nowIso });
    expect(report.verified.invalidated.length).toBe(1);
    expect(report.verified.invalidated[0].reason).toBe("FILE_MISSING");
  });

  afterAll(async () => {
    // Clean up tmp dir
    await fs.rm(tmp, { recursive: true, force: true });
  });
});
