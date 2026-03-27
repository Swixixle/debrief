import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { hashClaimExcerpt } from './hash';

export async function monitorDrift(args: {
  repoPath: string;
  baselinePath: string;
  outPath: string;
  nowIso?: string;
}): Promise<any> {
  const { repoPath, baselinePath, outPath, nowIso } = args;
  if (!fs.existsSync(path.join(repoPath, '.git'))) throw new Error('Not a git repo');
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  // Minimal schema check
  if (baseline.schema_version !== 'dossier_v2') throw new Error('Invalid schema_version');
  if (!baseline.claims || !Array.isArray(baseline.claims)) throw new Error('Missing claims');
  // Check baseline commit exists
  try {
    execSync(`git cat-file -e ${baseline.target.commit_sha}`, { cwd: repoPath });
  } catch {
    throw new Error('Cannot resolve baseline commit in repo');
  }
  // Get current commit
  const currentCommit = execSync('git rev-parse HEAD', { cwd: repoPath }).toString().trim();
  const currentCreatedAt = nowIso || new Date().toISOString();
  // VERIFIED drift logic
  const still_valid: string[] = [];
  const drifted: any[] = [];
  const invalidated: any[] = [];
  for (const claim of baseline.claims) {
    if (claim.epistemic_status !== 'VERIFIED') continue;
    const ev = claim.evidence && claim.evidence[0];
    if (!ev || !ev.file) {
      invalidated.push({ claim_id: claim.claim_id, reason: 'NO_EVIDENCE' });
      continue;
    }
    // Try to read file at HEAD
    let fileContent: string;
    try {
      fileContent = execSync(`git show HEAD:${ev.file}`, { cwd: repoPath }).toString();
    } catch {
      invalidated.push({ claim_id: claim.claim_id, reason: 'FILE_MISSING' });
      continue;
    }
    // Compute hash
    const lines = fileContent.split('\n').slice(ev.line_start - 1, ev.line_end);
    const canon = lines.join('\n');
    const hashResult = hashClaimExcerpt(path.join(repoPath, ev.file), ev.line_start, ev.line_end);
    if (hashResult.error === 'FILE_MISSING') {
      invalidated.push({ claim_id: claim.claim_id, reason: 'FILE_MISSING' });
      continue;
    }
    const computedHash = hashResult.excerptHash;
    const expectedHash = ev.excerpt_hash;
    if (computedHash === expectedHash) {
      still_valid.push(claim.claim_id);
    } else {
      drifted.push({
        claim_id: claim.claim_id,
        expected_hash: expectedHash,
        computed_hash: computedHash,
        file: ev.file,
        line_start: ev.line_start,
        line_end: ev.line_end
      });
    }
  }
  // UNKNOWNs (empty for now)
  const persisted_unknowns: string[] = [];
  const resolved_unknowns: string[] = [];
  const new_unknowns: string[] = [];
  // Scores delta (stub)
  const confidence_overall_delta = 0;
  const trust_score_delta = 0;
  // Time delta
  const time_delta_seconds = Math.abs((new Date(currentCreatedAt).getTime() - new Date(baseline.created_at).getTime()) / 1000);
  const commit_changed = baseline.target.commit_sha !== currentCommit;
  const driftReport = {
    schema_version: 'drift_report_v1',
    baseline: {
      created_at: baseline.created_at,
      commit: baseline.target.commit_sha,
      run_id: baseline.generator.git_sha || ''
    },
    current: {
      created_at: currentCreatedAt,
      commit: currentCommit,
      run_id: ''
    },
    time_delta_seconds,
    commit_changed,
    verified: {
      still_valid,
      drifted,
      invalidated,
      newly_verified: []
    },
    unknown: {
      persisted_unknowns,
      resolved_unknowns,
      new_unknowns
    },
    scores: {
      confidence_overall_delta,
      trust_score_delta
    }
  };
  fs.writeFileSync(outPath, JSON.stringify(driftReport, null, 2));
  return driftReport;
}
