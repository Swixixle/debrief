# Repo Recon Dossier v2 Schema

This document describes the structure and fields of Dossier v2, as specified in `shared/schemas/dossier_v2.schema.json`.

---

## Top-level Fields
- `schema_version`: "dossier_v2"
- `generator`: { name, version, git_sha, build_time }
- `target`: { repo_url, commit_sha, default_branch }
- `canonicalization_version`: string
- `hash_algorithm`: "sha256"
- `hash_encoding`: "hex"
- `created_at`: ISO timestamp

## Claims Array
Each claim includes:
- `claim_id`: stable string
- `fingerprint`: stable string
- `epistemic_status`: VERIFIED|INFERRED|UNKNOWN|DRIFTED|INVALIDATED
- `claim_type`: controlled vocabulary (see schema)
- `subject`: deterministic normalized string
- `summary`: human-readable
- `evidence`: array of evidence objects
  - `repo_commit`, `file`, `line_start`, `line_end`, `excerpt_hash`, `excerpt_preview` (optional, max 500 chars), `redactions` (if any)
- `unknown_reason`: required if UNKNOWN
- `confidence`: 0..1 (optional)

## Aggregates
- `scores`: { confidence_overall, confidence_weighted, critical_unknowns, core_module_coverage }
- `questions_for_maintainer`: array
- `security_warnings`: array
- `dependency_graph_ref`: string (optional)

## Integrity
- `dossier_hash`: hash of canonicalized JSON form
- `dossier_signature`: optional
- `audit_trail`: array of { timestamp, outcome }

---

## Validation
- Use `reporecon validate-dossier <dossier.json>` to validate against schema
- Non-zero exit on failure

---

## End of Schema Doc
