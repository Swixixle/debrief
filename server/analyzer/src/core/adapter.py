"""
Phase 2: EvidencePack Adapter

Assembles existing extraction outputs into a stable EvidencePack v1
contract for governance features. Does NOT modify original artifacts.

Verification policy:
  - Delegated entirely to verify_policy.is_verified_claim().
  - Claims are grouped by their original extractor-assigned section.
  - No keyword reclassification or inference is performed.

All downstream rendering and diff operations consume this pack only.
"""

import json
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone

from .verify_policy import is_verified_claim, get_verified_evidence
from ..version import TOOL_VERSION


EVIDENCE_PACK_VERSION = "1.0"

REQUIRED_PACK_FIELDS = {
    "evidence_pack_version",
    "tool_version",
    "generated_at",
    "mode",
    "run_id",
    "verified",
    "verified_structural",
    "unknowns",
    "metrics",
    "hashes",
    "summary",
    "coverage",
}


def validate_evidence_pack(pack: Dict[str, Any]) -> List[str]:
    errors = []
    for field in REQUIRED_PACK_FIELDS:
        if field not in pack:
            errors.append(f"missing required field: {field}")
    if "evidence_pack_version" in pack and pack["evidence_pack_version"] != EVIDENCE_PACK_VERSION:
        errors.append(f"unsupported schema version: {pack['evidence_pack_version']} (expected {EVIDENCE_PACK_VERSION})")
    if "tool_version" in pack and not pack["tool_version"]:
        errors.append("tool_version is empty")
    if "run_id" in pack and not pack["run_id"]:
        errors.append("run_id is empty")
    coverage = pack.get("coverage", {})
    if isinstance(coverage, dict):
        if "analyzed_files" not in coverage:
            errors.append("coverage missing analyzed_files")
        if "total_files_seen" not in coverage:
            errors.append("coverage missing total_files_seen")
    return errors


def build_evidence_pack(
    howto: Dict[str, Any],
    claims: Dict[str, Any],
    coverage: Dict[str, Any],
    file_index: List[str],
    known_unknowns: List[Dict[str, Any]],
    replit_profile: Optional[Dict[str, Any]] = None,
    mode: str = "github",
    run_id: Optional[str] = None,
    skipped_files: int = 0,
    skipped_types: Optional[List[str]] = None,
    timeouts: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Build an EvidencePack v1 from existing analyzer outputs.
    This is a pure post-processing function — it reads but never modifies
    the original extraction artifacts.

    Only claims passing verify_policy.is_verified_claim() are included.
    Claims are grouped by their extractor-assigned section.
    """
    verified_claims = _get_verified_claims(claims)

    total_files_seen = len(file_index) + skipped_files

    pack: Dict[str, Any] = {
        "evidence_pack_version": EVIDENCE_PACK_VERSION,
        "tool_version": TOOL_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": mode,
        "run_id": run_id,
        "verified": _group_by_section(verified_claims),
        "verified_structural": _build_verified_structural(verified_claims, howto, file_index),
        "unknowns": known_unknowns,
        "metrics": _build_metrics(howto, claims, known_unknowns, coverage),
        "hashes": {
            "snippets": _collect_snippet_hashes(claims, howto),
        },
        "summary": {
            "total_files": len(file_index),
            "total_claims": len(_get_claims_list(claims)),
            "verified_claims": len(verified_claims),
            "unknown_categories": len([
                u for u in known_unknowns
                if u.get("status") == "UNKNOWN"
            ]),
            "verified_categories": len([
                u for u in known_unknowns
                if u.get("status") == "VERIFIED"
            ]),
        },
        "coverage": {
            "analyzed_files": len(file_index),
            "total_files_seen": total_files_seen,
            "skipped_files": skipped_files,
            "skipped_types": skipped_types or [],
            "timeouts": timeouts or [],
            "partial": skipped_files > 0 or bool(timeouts),
        },
    }

    if replit_profile:
        pack["replit_profile"] = {
            "is_replit": replit_profile.get("is_replit", False),
            "run_command": replit_profile.get("run_command"),
            "language": replit_profile.get("language"),
            "port": replit_profile.get("port_binding", {}).get("port") if isinstance(replit_profile.get("port_binding"), dict) else None,
        }

    return pack


def save_evidence_pack(pack: Dict[str, Any], output_dir: Path) -> Path:
    errors = validate_evidence_pack(pack)
    if errors:
        raise RuntimeError(
            f"EvidencePack v1 schema validation failed ({len(errors)} error(s)):\n"
            + "\n".join(f"  - {e}" for e in errors)
        )
    path = output_dir / "evidence_pack.v1.json"
    with open(path, "w") as f:
        json.dump(pack, f, indent=2, default=str)
    return path


def load_evidence_pack(path: Path) -> Dict[str, Any]:
    with open(path) as f:
        return json.load(f)


def _get_claims_list(claims: Dict[str, Any]) -> List[Dict]:
    if isinstance(claims, dict):
        return claims.get("claims", [])
    return []


def _get_verified_claims(claims: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Return only claims that pass verify_policy.is_verified_claim().
    This is the only way a claim enters the EvidencePack's verified section.
    """
    result = []
    for claim in _get_claims_list(claims):
        if is_verified_claim(claim):
            result.append({
                "id": claim.get("id", ""),
                "statement": claim.get("statement", ""),
                "section": claim.get("section", ""),
                "evidence": get_verified_evidence(claim),
                "confidence": claim.get("confidence", 0),
            })
    return result


def _group_by_section(verified_claims: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """
    Group verified claims by their extractor-assigned section.
    No reclassification — sections are used as-is from the extractor.
    """
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for claim in verified_claims:
        section = claim.get("section", "uncategorized")
        if section not in groups:
            groups[section] = []
        groups[section].append(claim)
    return groups


def _build_verified_structural(
    verified_claims: List[Dict[str, Any]],
    howto: Dict[str, Any],
    file_index: List[str],
) -> Dict[str, Any]:
    """
    Structural namespace for governance-grade surface mapping.

    All buckets are currently empty — populated ONLY when dedicated
    deterministic structural extractors exist that:
      1. Scan actual source artifacts (lockfiles, route definitions, etc.)
      2. Extract exact lines from those artifacts
      3. Compute and verify snippet_hash against the source file

    NOT populated from:
      - Claims (claims are outputs, not structural inputs)
      - Howto/documentation surface (narrative, not system surface)
      - File-index pattern matching (filename presence != verified structure)

    Each bucket will be implemented by a dedicated extractor:
      - dependencies: lockfile parser (package-lock.json, requirements.txt, etc.)
      - routes: AST/regex route extractor over source files
      - schemas: migration/model file parser
      - enforcement: auth/middleware pattern detector over source files
    """
    return {
        "routes": [],
        "dependencies": [],
        "schemas": [],
        "enforcement": [],
        "_notes": {
            "routes": "not_implemented: requires AST/regex route extractor over source files",
            "dependencies": "not_implemented: requires lockfile parser (package-lock.json, requirements.txt, etc.)",
            "schemas": "not_implemented: requires migration/model file parser",
            "enforcement": "not_implemented: requires auth/middleware pattern detector over source files",
        },
    }


def _build_metrics(
    howto: Dict[str, Any],
    claims: Dict[str, Any],
    known_unknowns: List[Dict[str, Any]],
    coverage: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Build metrics namespace with clear separation:
      - rci: Reporting Completeness Index (composite maturity)
      - dci_v1_claims_visibility: claims-only visibility ratio
    """
    claim_list = _get_claims_list(claims)
    total_claims = len(claim_list)
    verified_count = len(_get_verified_claims(claims))
    claims_coverage = (verified_count / total_claims) if total_claims > 0 else 0.0

    total_categories = len(known_unknowns)
    verified_categories = len([u for u in known_unknowns if u.get("status") == "VERIFIED"])
    unknowns_coverage = (verified_categories / total_categories) if total_categories > 0 else 0.0

    completeness = howto.get("completeness", {})
    howto_score = completeness.get("score", 0) if isinstance(completeness, dict) else 0
    howto_max = completeness.get("max", 100) if isinstance(completeness, dict) else 100
    howto_coverage = (howto_score / howto_max) if howto_max > 0 else 0.0

    rci_score = round((claims_coverage + unknowns_coverage + howto_coverage) / 3.0, 4)

    return {
        "rci_reporting_completeness": {
            "score": rci_score,
            "label": "RCI — Reporting Completeness",
            "formula": "average(claims_coverage, unknowns_coverage, howto_completeness)",
            "components": {
                "claims_coverage": round(claims_coverage, 4),
                "unknowns_coverage": round(unknowns_coverage, 4),
                "howto_completeness": round(howto_coverage, 4),
            },
            "interpretation": "Composite completeness of PTA reporting. NOT a security or structural visibility score.",
        },
        "dci_v1_claim_visibility": {
            "score": round(claims_coverage, 4),
            "label": "DCI_v1_claim_visibility",
            "formula": "verified_claims / total_claims",
            "interpretation": "Percent of claims with deterministic hash-verified evidence. This is claim-evidence visibility, NOT system surface visibility.",
        },
        "dci_v2_structural_visibility": {
            "score": None,
            "label": "DCI_v2_structural_visibility (not implemented)",
            "formula": "verified_structural_items / total_structural_surface",
            "interpretation": "Structural surface visibility (routes/deps/schemas/enforcement). Not yet implemented — requires dedicated structural extractors.",
            "status": "not_implemented",
        },
    }


def _collect_snippet_hashes(claims: Dict[str, Any], howto: Dict[str, Any]) -> List[str]:
    hashes = set()

    for claim in _get_claims_list(claims):
        for ev in claim.get("evidence", []):
            if isinstance(ev, dict):
                h = ev.get("snippet_hash", "")
                if h:
                    hashes.add(h)

    for section in [
        "install_steps",
        "config",
        "run_dev",
        "run_prod",
        "verification_steps",
        "common_failures",
        "usage_examples",
    ]:
        items = howto.get(section, [])
        if isinstance(items, dict):
            items = [items]
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict):
                    ev = item.get("evidence")
                    if isinstance(ev, dict) and ev.get("snippet_hash"):
                        hashes.add(ev["snippet_hash"])
                    elif isinstance(ev, list):
                        for e in ev:
                            if isinstance(e, dict) and e.get("snippet_hash"):
                                hashes.add(e["snippet_hash"])

    return sorted(hashes)
