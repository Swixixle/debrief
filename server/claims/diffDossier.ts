import * as fs from 'fs';
import * as path from 'path';

export function diffDossier(oldPath: string, newPath: string, outPath: string) {
  const oldDossier = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
  const newDossier = JSON.parse(fs.readFileSync(newPath, 'utf8'));

  const oldClaims = Object.fromEntries((oldDossier.claims || []).map((c: any) => [c.fingerprint || c.claim_id, c]));
  const newClaims = Object.fromEntries((newDossier.claims || []).map((c: any) => [c.fingerprint || c.claim_id, c]));

  // UNKNOWNs
  const oldUnknowns = Object.values(oldClaims).filter(c => c.epistemic_status === 'UNKNOWN');
  const newUnknowns = Object.values(newClaims).filter(c => c.epistemic_status === 'UNKNOWN');
  const oldUnknownKeys = new Set(oldUnknowns.map(c => c.fingerprint || c.claim_id));
  const newUnknownKeys = new Set(newUnknowns.map(c => c.fingerprint || c.claim_id));

  const persisted_unknowns = [...oldUnknownKeys].filter(k => newUnknownKeys.has(k));
  const resolved_unknowns = [...oldUnknownKeys].filter(k => !newUnknownKeys.has(k));
  const new_unknowns = [...newUnknownKeys].filter(k => !oldUnknownKeys.has(k));

  // VERIFIED
  const oldVerified = Object.values(oldClaims).filter(c => c.epistemic_status === 'VERIFIED');
  const newVerified = Object.values(newClaims).filter(c => c.epistemic_status === 'VERIFIED');
  const oldVerifiedKeys = new Set(oldVerified.map(c => c.fingerprint || c.claim_id));
  const newVerifiedKeys = new Set(newVerified.map(c => c.fingerprint || c.claim_id));

  const degraded_verified = [...oldVerifiedKeys].filter(k => !newVerifiedKeys.has(k));
  const new_verified = [...newVerifiedKeys].filter(k => !oldVerifiedKeys.has(k));

  // Scores delta
  const oldScore = oldDossier.scores?.confidence_overall || 0;
  const newScore = newDossier.scores?.confidence_overall || 0;
  const confidence_overall_delta = newScore - oldScore;
  const oldCritical = oldDossier.scores?.critical_unknowns || 0;
  const newCritical = newDossier.scores?.critical_unknowns || 0;
  const critical_unknowns_delta = newCritical - oldCritical;

  // Time delta
  const time_delta_seconds =
    (new Date(newDossier.created_at).getTime() - new Date(oldDossier.created_at).getTime()) / 1000;
  const commit_changed = oldDossier.target.commit_sha !== newDossier.target.commit_sha;

  const delta = {
    time_delta_seconds,
    commit_changed,
    commit_from: oldDossier.target.commit_sha,
    commit_to: newDossier.target.commit_sha,
    unknowns: {
      persisted_unknowns,
      resolved_unknowns,
      new_unknowns
    },
    verified: {
      degraded_verified,
      new_verified
    },
    scores_delta: {
      confidence_overall_delta,
      critical_unknowns_delta
    }
  };

  fs.writeFileSync(outPath, JSON.stringify(delta, null, 2));
  return delta;
}
